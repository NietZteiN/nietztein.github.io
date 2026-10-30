// Subject-based paths through the public catalogue, plus a visitor's local list.
// The catalogue owns book data; this module never reads the private Desk.
(function () {
	'use strict';
	var STORE_KEY = 'bookshelf.reading-list.v1';
	var PATHS_URL = 'assets/data/reading-paths.json';
	var MAX_NOTE = 4000;
	var catalog = Object.create(null), items = [], unresolvedItems = [], undoItems = [];
	var root, pathsDetails, pathsBody, listDetails, listBody, countEl, statusEl, storageEl, undoBar;
	var exportButton, clearButton, pathsLoaded = false, pathsLoading = false, noteTimer = 0;
	var detailBook = null, detailInfo = null, corruptStorage = false;

	function node(tag, cls, text) {
		var el = document.createElement(tag);
		if (cls) el.className = cls;
		if (text != null) el.textContent = text;
		return el;
	}
	function button(cls, text, action) {
		var el = node('button', cls, text); el.type = 'button';
		if (action) el.addEventListener('click', action);
		return el;
	}
	function itemFor(id) { return items.filter(function (item) { return item.id === id; })[0]; }
	function clone(item) { return { id: item.id, note: typeof item.note === 'string' ? item.note : '', addedAt: typeof item.addedAt === 'string' ? item.addedAt : '' }; }
	function validBookId(id) { return typeof id === 'string' && !!id && id.length <= 200 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id); }
	// Unresolved records remain local and unrendered. Editing the visible list
	// must not erase notes for books absent from today's public catalogue.
	function storedItems() { return items.map(clone).concat(unresolvedItems.map(clone)); }
	function setStatus(text) { clearTimeout(noteTimer); if (statusEl) statusEl.textContent = text; }
	function bookLink(book, cls) {
		var link = node('a', cls, book.t); link.href = '#/bookshelf/' + encodeURIComponent(book.id);
		if (book.l === 'JA') link.lang = 'ja';
		return link;
	}
	function loadState() {
		unresolvedItems = [];
		var raw;
		try {
			raw = window.localStorage.getItem(STORE_KEY);
			if (!raw) return [];
			var data = JSON.parse(raw), seen = Object.create(null);
			if (!data || data.version !== 1 || !Array.isArray(data.items)) throw new Error('invalid reading list');
			corruptStorage = false;
			var records = data.items.filter(function (item) {
				if (!item || !validBookId(item.id) || seen[item.id]) return false;
				seen[item.id] = true; return true;
			});
			unresolvedItems = records.filter(function (item) { return !catalog[item.id]; }).map(clone);
			return records.filter(function (item) { return !!catalog[item.id]; }).map(function (item) {
				return { id: item.id, note: typeof item.note === 'string' ? item.note.slice(0, MAX_NOTE) : '',
					addedAt: typeof item.addedAt === 'string' && !isNaN(Date.parse(item.addedAt)) ? item.addedAt : '' };
			});
		} catch (err) {
			corruptStorage = raw != null;
			storageEl.textContent = 'Your saved list could not be read. You can start a list for this visit and export it as JSON.';
			return [];
		}
	}
	function adoptList(persistent) {
		if (window.SavedStore && typeof window.SavedStore.adoptLegacy === 'function') {
			window.SavedStore.adoptLegacy('book', storedItems(), { source: 'reading-shelf', persistent: persistent });
		}
	}
	function saveState() {
		if (corruptStorage) {
			try {
				var raw = window.localStorage.getItem(STORE_KEY), value = raw ? JSON.parse(raw) : null;
				if (!raw || (value && value.version === 1 && Array.isArray(value.items))) corruptStorage = false;
			} catch (err) { /* Keep the unreadable original untouched. */ }
		}
		var storeCorrupt = window.SavedStore && typeof window.SavedStore.status === 'function' && window.SavedStore.status().issues.some(function (issue) { return issue.provider === 'book' && issue.reason === 'corrupt'; });
		if (corruptStorage || storeCorrupt) {
			storageEl.textContent = 'The saved reading list could not be read, so the original data has been kept. Changes last for this visit; export JSON to keep a copy.';
			adoptList(false);
			return false;
		}
		try {
			window.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, items: storedItems() }));
			storageEl.textContent = 'Your list and notes are saved in this browser. Export a copy to keep.';
			adoptList(true);
			return true;
		} catch (err) {
			storageEl.textContent = 'Browser storage is unavailable or full. Your list works for this visit; export JSON to keep it before leaving.';
			adoptList(false);
			return false;
		}
	}
	function focusSummary() {
		var summary = listDetails.querySelector('summary');
		try { summary.focus({ preventScroll: true }); } catch (err) { summary.focus(); }
	}
	function saveButton(book) {
		var b = button('rs-save', ''); b.setAttribute('data-book-id', book.id); updateSaveButton(b);
		b.addEventListener('click', function () {
			if (itemFor(book.id)) removeBook(book.id, false);
			else {
				items.push({ id: book.id, note: '', addedAt: new Date().toISOString() });
				var saved = saveState(); renderList(); refreshButtons();
				setStatus(book.t + (saved ? ' added to your reading list on this device.' : ' added to your list for this visit.'));
			}
		});
		return b;
	}
	function updateSaveButton(b) {
		var id = b.getAttribute('data-book-id'), saved = !!itemFor(id), book = catalog[id];
		b.textContent = saved ? 'Saved to your list' : 'Add to your list';
		b.setAttribute('aria-pressed', saved ? 'true' : 'false');
		b.setAttribute('aria-label', (saved ? 'Remove ' : 'Add ') + (book ? book.t : 'book') + (saved ? ' from your reading list' : ' to your reading list'));
	}
	function refreshButtons() {
		Array.prototype.forEach.call(document.querySelectorAll('.rs-save[data-book-id]'), updateSaveButton);
	}
	function removeBook(id, moveFocus) {
		var index = -1;
		items.forEach(function (item, i) { if (item.id === id) index = i; });
		if (index < 0) return;
		undoItems = [{ item: clone(items[index]), index: index }];
		items.splice(index, 1); saveState(); renderList(); refreshButtons();
		setStatus(catalog[id].t + ' removed. Undo is available.');
		if (moveFocus) {
			var buttons = listBody.querySelectorAll('.rs-remove');
			if (buttons.length) buttons[Math.min(index, buttons.length - 1)].focus();
			else focusSummary();
		}
	}
	function undo() {
		undoItems.forEach(function (entry) {
			if (!itemFor(entry.item.id)) items.splice(Math.min(entry.index, items.length), 0, clone(entry.item));
		});
		undoItems = []; saveState(); renderList(); refreshButtons(); focusSummary();
		setStatus('Restored to your reading list.');
	}
	function clearList() {
		if (!items.length || !window.confirm('Clear the ' + items.length + ' books shown in your reading list and their notes from this browser?')) return;
		undoItems = items.map(function (item, index) { return { item: clone(item), index: index }; });
		items = []; saveState(); renderList(); refreshButtons(); focusSummary();
		setStatus('The books shown in your reading list were cleared. Undo is available.');
	}
	function exportList() {
		var canonical = document.querySelector('link[rel="canonical"]');
		var base = canonical ? canonical.href.replace(/#.*$/, '') : window.location.origin + window.location.pathname;
		var output = { version: 1, exportedAt: new Date().toISOString(), books: items.map(function (item) {
			var book = catalog[item.id];
			return { id: item.id, title: book.t, author: book.a || '', url: base + '#/bookshelf/' + encodeURIComponent(item.id),
				note: item.note, addedAt: item.addedAt };
		}) };
		var url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/json' }));
		var a = node('a'); a.href = url; a.download = 'my-reading-list.json';
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
		setStatus('Your reading list was exported as JSON.');
	}
	function renderList() {
		if (!root) return;
		listBody.textContent = '';
		countEl.textContent = String(items.length);
		exportButton.disabled = clearButton.disabled = !items.length;
		undoBar.hidden = !undoItems.length;
		if (!items.length) {
			listBody.appendChild(node('p', 'rs-empty', 'Save books from a reading path or any book detail card. Add your own notes here.'));
			return;
		}
		var list = node('ol', 'rs-saved-books');
		items.forEach(function (item, index) {
			var book = catalog[item.id], row = node('li', 'rs-saved-book'); row.setAttribute('data-book-id', item.id);
			var top = node('div', 'rs-book-top'), title = node('div', 'rs-book-name');
			title.appendChild(bookLink(book, 'rs-title'));
			if (book.a) title.appendChild(node('span', 'rs-author', book.a));
			top.appendChild(title);
			var remove = button('rs-remove', 'Remove', function () { removeBook(item.id, true); });
			remove.setAttribute('aria-label', 'Remove ' + book.t + ' from your reading list');
			top.appendChild(remove); row.appendChild(top);
			var label = node('label', 'rs-note-label', 'Your note'); label.htmlFor = 'rs-note-' + index;
			row.appendChild(label);
			var note = node('textarea', 'rs-note'); note.id = label.htmlFor; note.rows = 2; note.maxLength = MAX_NOTE;
			note.value = item.note; note.placeholder = 'What would you like to remember?';
			note.setAttribute('aria-label', 'Your note for ' + book.t);
			note.addEventListener('input', function () {
				item.note = note.value.slice(0, MAX_NOTE);
				var saved = saveState(); clearTimeout(noteTimer);
				noteTimer = setTimeout(function () { setStatus(saved ? 'Note saved on this device.' : 'Note kept for this visit. Export JSON to keep a copy.'); }, 500);
			});
			row.appendChild(note); list.appendChild(row);
		});
		listBody.appendChild(list);
	}
	function renderPaths(data) {
		pathsBody.textContent = '';
		pathsBody.appendChild(node('p', 'rs-path-intro', 'Subject-based selections from the public catalogue. Open a title for its details.'));
		var paths = data && Array.isArray(data.paths) ? data.paths : [];
		var visiblePaths = 0;
		paths.forEach(function (path) {
			if (!path || typeof path.title !== 'string' || !Array.isArray(path.books)) return;
			var entries = path.books.filter(function (entry) { return entry && catalog[entry.id]; });
			if (!entries.length) return;
			visiblePaths++;
			var section = node('section', 'rs-path');
			section.appendChild(node('h4', '', path.title));
			if (typeof path.description === 'string') section.appendChild(node('p', 'rs-path-description', path.description));
			var list = node('ol', 'rs-path-books');
			entries.forEach(function (entry) {
				var book = catalog[entry.id], row = node('li', 'rs-path-book'), info = node('div', 'rs-path-book-info');
				info.appendChild(bookLink(book, 'rs-title'));
				if (book.a) info.appendChild(node('span', 'rs-author', book.a));
				if (typeof entry.note === 'string') info.appendChild(node('p', 'rs-curatorial-note', entry.note));
				row.appendChild(info); row.appendChild(saveButton(book)); list.appendChild(row);
			});
			section.appendChild(list); pathsBody.appendChild(section);
		});
		if (!visiblePaths) throw new Error('No reading paths are available.');
		pathsLoaded = true;
	}
	function loadPaths() {
		if (pathsLoaded || pathsLoading) return;
		pathsLoading = true; pathsBody.textContent = '';
		pathsBody.appendChild(node('p', 'rs-empty', 'Loading reading paths...'));
		fetch(PATHS_URL).then(function (r) { if (!r.ok) throw new Error('Reading paths unavailable'); return r.json(); })
			.then(renderPaths).catch(function () {
				pathsBody.textContent = '';
				pathsBody.appendChild(node('p', 'rs-empty', 'Reading paths could not be loaded. Your reading list is still available.'));
				pathsBody.appendChild(button('rs-action', 'Try again', loadPaths));
			}).then(function () { pathsLoading = false; });
	}
	function ensureRoot() {
		if (root) return true;
		var bookshelf = document.getElementById('bookshelf');
		if (!bookshelf) return false;
		root = node('section', 'reading-shelf'); root.id = 'reading-shelf'; root.setAttribute('aria-label', 'Reading paths and your reading list');
		pathsDetails = node('details', 'rs-panel rs-paths');
		var pathsSummary = node('summary', '', 'Reading paths'); pathsSummary.appendChild(node('span', 'rs-summary-hint', 'By subject'));
		pathsDetails.appendChild(pathsSummary); pathsBody = node('div', 'rs-panel-body'); pathsDetails.appendChild(pathsBody);
		pathsDetails.addEventListener('toggle', function () { if (pathsDetails.open) loadPaths(); });
		root.appendChild(pathsDetails);
		listDetails = node('details', 'rs-panel rs-your-list');
		var summary = node('summary', ''); summary.appendChild(document.createTextNode('Your reading list '));
		countEl = node('span', 'rs-list-count', '0'); summary.appendChild(countEl); summary.appendChild(node('span', 'rs-summary-hint', 'On this device'));
		listDetails.appendChild(summary);
		var body = node('div', 'rs-panel-body');
		storageEl = node('p', 'rs-storage-note', 'Your list and notes are saved in this browser. Export a copy to keep.'); body.appendChild(storageEl);
		var actions = node('div', 'rs-list-actions');
		exportButton = button('rs-action', 'Export JSON', exportList); actions.appendChild(exportButton);
		clearButton = button('rs-action', 'Clear list', clearList); actions.appendChild(clearButton); body.appendChild(actions);
		undoBar = node('div', 'rs-undo'); undoBar.hidden = true;
		undoBar.appendChild(node('span', '', 'Removed from your list. ')); undoBar.appendChild(button('rs-action', 'Undo', undo)); body.appendChild(undoBar);
		listBody = node('div', 'rs-list-content'); body.appendChild(listBody); listDetails.appendChild(body); root.appendChild(listDetails);
		statusEl = node('p', 'rs-status'); statusEl.setAttribute('role', 'status'); statusEl.setAttribute('aria-live', 'polite'); root.appendChild(statusEl);
		bookshelf.parentNode.insertBefore(root, bookshelf);
		return true;
	}
	function decorateDetail(book, info) {
		detailBook = book; detailInfo = info;
		if (!root || !book || !catalog[book.id] || !info || info.querySelector('.rs-detail-save')) return;
		var box = node('div', 'rs-detail-save'); box.appendChild(saveButton(book));
		box.appendChild(node('span', 'rs-detail-hint', 'Your reading list · on this device'));
		info.appendChild(box);
	}
	function setCatalog(books) {
		if (!Array.isArray(books) || !books.length || !ensureRoot()) return;
		books.forEach(function (book) { if (book && typeof book.id === 'string' && typeof book.t === 'string') catalog[book.id] = book; });
		items = loadState(); renderList();
		if (window.SavedStore && typeof window.SavedStore.snapshot === 'function') {
			var snapshot = window.SavedStore.snapshot().filter(function (item) { return item.kind === 'book' && validBookId(item.id); });
			items = snapshot.filter(function (item) { return !!catalog[item.id]; }).map(clone);
			unresolvedItems = snapshot.filter(function (item) { return !catalog[item.id]; }).map(clone);
			renderList();
		}
		if (detailBook && detailInfo) decorateDetail(detailBook, detailInfo);
	}
	document.addEventListener('saved:change', function (ev) {
		var detail = ev.detail || {};
		if (!root || detail.source === 'reading-shelf' || !Array.isArray(detail.items) || (Array.isArray(detail.changed) && !detail.changed.some(function (item) { return item.kind === 'book'; }))) return;
		var active = document.activeElement, inside = listBody.contains(active);
		var row = inside && active.closest('.rs-saved-book'), id = row && row.getAttribute('data-book-id');
		var isNote = inside && active.classList.contains('rs-note'), start = isNote ? active.selectionStart : 0, end = isNote ? active.selectionEnd : 0;
		items = detail.items.filter(function (item) { return item.kind === 'book' && catalog[item.id]; }).map(function (item) {
			return { id: item.id, note: typeof item.note === 'string' ? item.note : '', addedAt: typeof item.addedAt === 'string' ? item.addedAt : '' };
		});
		unresolvedItems = detail.items.filter(function (item) { return item.kind === 'book' && validBookId(item.id) && !catalog[item.id]; }).map(clone);
		renderList(); refreshButtons();
		if (inside) {
			var replacement = Array.prototype.filter.call(listBody.querySelectorAll('.rs-saved-book'), function (candidate) { return candidate.getAttribute('data-book-id') === id; })[0];
			if (replacement) {
				var control = replacement.querySelector(isNote ? '.rs-note' : '.rs-remove');
				try { control.focus({ preventScroll: true }); } catch (err) { control.focus(); }
				if (isNote) control.setSelectionRange(Math.min(start, control.value.length), Math.min(end, control.value.length));
			} else focusSummary();
		}
	});
	document.addEventListener('bookshelf:loaded', function (ev) { setCatalog(ev.detail && ev.detail.books); });
	document.addEventListener('bookshelf:book-open', function (ev) { if (ev.detail) decorateDetail(ev.detail.book, ev.detail.info); });
	function boot() {
		if (window.Bookshelf && window.Bookshelf.getCatalog) setCatalog(window.Bookshelf.getCatalog());
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
