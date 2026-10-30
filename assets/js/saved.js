// A visitor's unified local collection. Stored IDs are resolved only against
// public registries; titles and destinations are never read from localStorage.
(function () {
	'use strict';
	var TYPES = [
		{ kind: 'post', label: 'Writing' }, { kind: 'publication', label: 'Research' },
		{ kind: 'book', label: 'Books' }, { kind: 'experiment', label: 'Experiments' }
	];
	function key(kind, id) { return kind + ':' + id; }
	function text(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }
	function registryFor(publications, posts, toys, library, additions) {
		var registry = Object.create(null);
		function add(kind, id, title, subtitle, description) {
			if (typeof id !== 'string' || !id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || !text(title)) return;
			if (kind !== 'book' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return;
			registry[key(kind, id)] = { kind: kind, id: id, title: text(title), subtitle: text(subtitle), description: text(description) };
		}
		(Array.isArray(publications) ? publications : []).forEach(function (paper) {
			if (paper) add('publication', paper.id, paper.title, [paper.authorsText, paper.year].filter(Boolean).join(' / '), paper.venue);
		});
		(Array.isArray(posts) ? posts : []).forEach(function (post) {
			if (post && typeof post.file === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(post.file)) add('post', post.slug, post.title, post.date, post.summary);
		});
		(toys && Array.isArray(toys.toys) ? toys.toys : []).forEach(function (toy) {
			if (toy && toy.status === 'live' && Array.isArray(toy.surfaces) && toy.surfaces.some(function (surface) { return surface === 'grid' || surface === 'views'; })) {
				add('experiment', toy.slug, toy.title, '', toy.desc);
			}
		});
		var baseBooks = library && Array.isArray(library.books) ? library.books : [], baseIds = Object.create(null);
		baseBooks.forEach(function (book) { if (book && typeof book.id === 'string') baseIds[book.id] = true; });
		var extraBooks = (additions && Array.isArray(additions.books) ? additions.books : []).filter(function (book) {
			return book && !baseIds[book.id];
		});
		baseBooks.concat(extraBooks).forEach(function (book) {
			if (book) add('book', book.id, book.t, book.a, book.d);
		});
		return registry;
	}
	if (typeof module !== 'undefined' && module.exports) { module.exports = { registryFor: registryFor }; return; }
	if (typeof window === 'undefined' || window.Saved) return;
	var script = document.currentScript;
	var rootUrl = script && script.src ? new URL('../../', script.src).href : new URL('./', window.location.href).href;
	var store = window.SavedStore, registry = null, failures = [], metadataPromise = null;
	var root, list, count, search, kindSelect, status, notice, missing, retry, undoBar, undoButton, exportButton, clearButton;
	var query = '', kind = '', undoItems = [], requestId = 0, urlTimer = 0;
	var importButton, importFile, importPanel, importHeading, importName, importSummary, importList, importRemainder, importError, importStatus, importConfirm, importCancel;
	var importPreview = null, importCandidates = [], importReader = null, importSerial = 0, importRestoring = false;
	var IMPORT_PREVIEW_LIMIT = 25;

	function node(tag, cls, value) { var result = document.createElement(tag); if (cls) result.className = cls; if (value != null) result.textContent = value; return result; }
	function button(id, value, handler) { var result = node('button', 'saved-button', value); if (id) result.id = id; result.type = 'button'; if (handler) result.addEventListener('click', handler); return result; }
	function labelFor(value) { return TYPES.filter(function (item) { return item.kind === value; })[0]; }
	function onRoute() { return /^#\/saved(?:\/?|\?.*)$/.test(window.location.hash); }
	function href(entity) {
		var route = entity.kind === 'post' ? '#/post/' + encodeURIComponent(entity.id) :
			entity.kind === 'publication' ? '#/publications?paper=' + encodeURIComponent(entity.id) :
			entity.kind === 'book' ? '#/bookshelf/' + encodeURIComponent(entity.id) : 'misc/' + entity.id + '/';
		return new URL(route, rootUrl).href;
	}
	function fold(value) {
		var result = String(value || '').toLowerCase();
		if (result.normalize) result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		return result;
	}
	function resolved() {
		if (!registry || !store) return [];
		return store.snapshot().filter(function (item) { return !!registry[key(item.kind, item.id)]; }).map(function (item) {
			return { saved: item, entity: registry[key(item.kind, item.id)] };
		}).sort(function (a, b) {
			var at = Date.parse(a.saved.addedAt), bt = Date.parse(b.saved.addedAt);
			if (!isNaN(at) && !isNaN(bt) && at !== bt) return bt - at;
			if (isNaN(at) !== isNaN(bt)) return isNaN(at) ? 1 : -1;
			return a.entity.title.localeCompare(b.entity.title);
		});
	}
	function updateHeader() {
		if (!store) return;
		var total = registry && !failures.length ? resolved().length : store.snapshot().length;
		Array.prototype.forEach.call(document.querySelectorAll('[data-saved-count]'), function (el) { el.textContent = String(total); el.hidden = total === 0; });
		var open = document.getElementById('saved-open');
		if (open) { open.hidden = false; open.setAttribute('aria-label', 'Saved items' + (total ? ', ' + total + ' saved' : '')); }
	}
	function readState() {
		var params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
		query = params.get('q') || ''; kind = labelFor(params.get('kind')) ? params.get('kind') : '';
		search.value = query; kindSelect.value = kind;
	}
	function writeState() {
		clearTimeout(urlTimer); if (!onRoute()) return;
		var params = new URLSearchParams(); if (kind) params.set('kind', kind); if (query.trim()) params.set('q', query.trim());
		try { window.history.replaceState(null, '', '#/saved' + (params.toString() ? '?' + params.toString() : '')); } catch (e) { /* Filters still work for this visit. */ }
	}
	function data(path, label) {
		return fetch(new URL(path, rootUrl).href, { cache: 'no-cache' }).then(function (response) {
			if (!response.ok) throw new Error('Source unavailable'); return response.json();
		}).then(function (value) { return { value: value, label: label, ok: true }; }).catch(function () { return { value: null, label: label, ok: false }; });
	}
	function load() {
		if (!metadataPromise) metadataPromise = Promise.all([
			data('assets/data/publications.json', 'research'), data('blog/index.json', 'writing'),
			data('misc/toys.json', 'experiments'), data('assets/data/library.json', 'books'), data('assets/data/library-additions.json', 'additional books')
		]).then(function (results) {
			failures = results.filter(function (result) { return !result.ok; }).map(function (result) { return result.label; });
			registry = registryFor(results[0].value, results[1].value, results[2].value, results[3].value, results[4].value);
			updateHeader(); return registry;
		});
		return metadataPromise;
	}
	function storageNotice() {
		if (!notice || !store) return;
		var state = store.status();
		notice.textContent = state.persistent ? 'Saved in this browser. Export JSON to keep a copy.' :
			state.issues.some(function (issue) { return issue.reason === 'corrupt'; }) ?
				'Some saved browser data could not be read and has been left untouched. New changes work for this visit; export JSON to keep them.' :
				'Browser storage is unavailable or full. Changes work for this visit; export JSON to keep them before leaving.';
	}
	function announce(message) { if (status) status.textContent = message; }
	function syncUndo() { if (undoBar) undoBar.hidden = !undoItems.length; }
	function focusItem(item, selector) {
		var row = Array.prototype.filter.call(list.querySelectorAll('.saved-item'), function (candidate) {
			return candidate.getAttribute('data-kind') === item.kind && candidate.getAttribute('data-id') === item.id;
		})[0];
		if (row) { var target = row.querySelector(selector || '.saved-item-link'); try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } return true; }
		return false;
	}
	function removeItem(item, position) {
		var removed = store.remove(item.kind, item.id, { source: 'saved-hub' }); if (!removed) return;
		undoItems = [removed]; render(); announce('Removed from saved items. Undo is available.');
		var buttons = list.querySelectorAll('.saved-remove');
		if (buttons.length) buttons[Math.min(position, buttons.length - 1)].focus(); else undoButton.focus();
	}
	function undo() {
		var previous = undoItems.slice(), added = store.restore(previous, { source: 'saved-hub' }); undoItems = []; render();
		announce(added ? 'Restored ' + added + (added === 1 ? ' item.' : ' items.') : 'These items were already saved. Their current notes have been kept.');
		if (!previous.some(function (item) { return focusItem(item); })) search.focus();
	}
	function clear() {
		var items = resolved().map(function (item) { return item.saved; });
		if (!items.length || !window.confirm('Clear all ' + items.length + ' saved items? This also removes notes saved with books. You can Undo this while the page stays open.')) return;
		undoItems = store.clear({ source: 'saved-hub', items: items }); render(); announce('Saved items cleared. Undo is available.'); undoButton.focus();
	}
	function exportItems() {
		var output = { version: 1, exportedAt: new Date().toISOString(), items: store.snapshot().map(function (item) {
			var result = { kind: item.kind, id: item.id }, entity = registry && registry[key(item.kind, item.id)];
			if (entity) { result.title = entity.title; result.url = href(entity); }
			else result.unresolved = true;
			if (typeof item.addedAt === 'string') result.addedAt = item.addedAt;
			if (typeof item.note === 'string') result.note = item.note;
			return result;
		}) };
		var url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/json' }));
		var link = node('a'); link.href = url; link.download = 'site-saved-items.json'; document.body.appendChild(link); link.click(); link.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 30000); announce('Saved items exported as JSON.');
	}
	function invalidateImport() {
		importSerial++;
		if (importReader) {
			importReader.onload = importReader.onerror = importReader.onabort = null;
			try { importReader.abort(); } catch (e) { /* Already finished. */ }
			importReader = null;
		}
		importPreview = null; importCandidates = [];
		if (importFile) importFile.value = '';
		if (importPanel) { importPanel.hidden = true; importPanel.removeAttribute('aria-busy'); }
	}
	function focusImportReview() {
		if (!onRoute()) return;
		var active = document.activeElement;
		if (active === document.body || active === importButton || active === importFile || importPanel.contains(active)) {
			try { importHeading.focus({ preventScroll: true }); } catch (e) { importHeading.focus(); }
			var header = document.querySelector('.site-header');
			importHeading.style.scrollMarginTop = ((header ? header.offsetHeight : 0) + 16) + 'px';
			importHeading.scrollIntoView({ block: 'start', behavior: 'instant' });
		}
	}
	function cancelImport() {
		invalidateImport(); announce('Import canceled. Nothing was restored.');
		if (onRoute()) importButton.focus();
	}
	function importFailure(error) {
		importPreview = null; importPanel.hidden = false; importPanel.removeAttribute('aria-busy');
		importSummary.hidden = importList.hidden = importRemainder.hidden = true; importConfirm.disabled = true;
		importError.hidden = false;
		var messages = error && Array.isArray(error.errors) ? error.errors.slice(0, 5).map(function (entry) {
			return (entry.row ? 'Item ' + entry.row + ': ' : '') + entry.message;
		}) : [];
		importError.textContent = messages.length ? messages.join(' ') + (error.errors.length > messages.length ? ' More items also need correction.' : '') :
			(error && error.message ? error.message : 'This file could not be read as a Saved items backup.');
		importStatus.textContent = 'No saved items were changed. Choose another JSON backup or cancel.';
		focusImportReview();
	}
	function refreshImportReview() {
		if (!importPreview || importRestoring) return;
		var current = store.snapshot(), plan = window.SavedImport.plan(importCandidates, current);
		var fullPlan = window.SavedImport.plan(importPreview.items, current);
		var currentKeys = Object.create(null);
		current.forEach(function (item) { currentKeys[key(item.kind, item.id)] = true; });
		importSummary.querySelector('[data-import-count="additions"]').textContent = String(plan.additionCount);
		importSummary.querySelector('[data-import-count="existing"]').textContent = String(fullPlan.alreadySavedCount);
		importSummary.querySelector('[data-import-count="duplicates"]').textContent = String(importPreview.duplicates);
		var activeRestore = document.activeElement === importConfirm;
		importConfirm.disabled = !plan.additionCount;
		importConfirm.textContent = plan.additionCount ? 'Restore ' + plan.additionCount + (plan.additionCount === 1 ? ' new item' : ' new items') : 'No new items to restore';
		Array.prototype.forEach.call(importList.querySelectorAll('[data-import-kind]'), function (row) {
			var type = row.getAttribute('data-import-kind'), id = row.getAttribute('data-import-id'), entity = registry && registry[key(type, id)];
			row.querySelector('.saved-import-item-title').textContent = entity ? entity.title : id;
			row.querySelector('.saved-import-item-kind').textContent = labelFor(type).label + (entity ? '' : ' / ID unavailable in the public catalogue');
			var reviewed = importCandidates.some(function (item) { return item.kind === type && item.id === id; });
			row.querySelector('.saved-import-item-state').textContent = currentKeys[key(type, id)] ? 'Already saved; current item and note kept' : reviewed ? 'New item' : 'No longer saved; not part of the reviewed additions';
		});
		if (activeRestore && importConfirm.disabled) importCancel.focus();
	}
	function reviewImport(parsed) {
		importPreview = parsed; importPanel.removeAttribute('aria-busy'); importError.hidden = true;
		importSummary.hidden = importList.hidden = false; importList.textContent = '';
		var plan = window.SavedImport.plan(parsed.items, store.snapshot());
		importCandidates = plan.additions.slice();
		var existingKeys = Object.create(null); plan.alreadySaved.forEach(function (item) { existingKeys[key(item.kind, item.id)] = true; });
		var ordered = plan.additions.concat(parsed.items.filter(function (item) { return !!existingKeys[key(item.kind, item.id)]; }));
		ordered.slice(0, IMPORT_PREVIEW_LIMIT).forEach(function (item) {
			var row = node('li', 'saved-import-item'); row.setAttribute('data-import-kind', item.kind); row.setAttribute('data-import-id', item.id);
			row.appendChild(node('span', 'saved-import-item-kind')); row.appendChild(node('strong', 'saved-import-item-title'));
			row.appendChild(node('span', 'saved-import-item-state'));
			if (typeof item.note === 'string' && item.note) row.appendChild(node('span', 'saved-import-note-hint', 'Backup includes a note (' + item.note.length.toLocaleString() + ' characters).'));
			importList.appendChild(row);
		});
		importRemainder.hidden = ordered.length <= IMPORT_PREVIEW_LIMIT;
		importRemainder.textContent = 'Showing ' + Math.min(ordered.length, IMPORT_PREVIEW_LIMIT) + ' of ' + ordered.length + ' unique items. The totals above cover the full backup.';
		importStatus.textContent = 'Backup checked. Nothing has been restored yet.';
		refreshImportReview(); focusImportReview();
	}
	function selectImportFile() {
		invalidateImport();
		importFile.click();
	}
	function readImportFile() {
		var file = importFile.files && importFile.files[0];
		if (!file) { cancelImport(); return; }
		invalidateImport();
		var request = importSerial;
		importPanel.hidden = false; importPanel.setAttribute('aria-busy', 'true'); importName.textContent = file.name;
		importError.hidden = true; importSummary.hidden = importList.hidden = importRemainder.hidden = true; importConfirm.disabled = true;
		importStatus.textContent = 'Reading backup...';
		if (!window.SavedImport || typeof window.SavedImport.parse !== 'function') { importFailure(new Error('Backup restore could not load. Reload this page and try again.')); return; }
		if (file.size > window.SavedImport.MAX_BYTES) { importFailure(new Error('This backup is too large. Choose a JSON file up to ' + (window.SavedImport.MAX_BYTES / 1048576) + ' MB.')); return; }
		var reader = new FileReader(); importReader = reader;
		reader.onload = function () {
			if (request !== importSerial || !onRoute()) return;
			importReader = null;
			try { reviewImport(window.SavedImport.parse(String(reader.result))); } catch (error) { importFailure(error); }
		};
		reader.onerror = reader.onabort = function () {
			if (request !== importSerial || !onRoute()) return;
			importReader = null; importFailure(new Error('The backup file could not be read. Choose it again or try another file.'));
		};
		try { reader.readAsText(file); } catch (error) { importReader = null; importFailure(error); }
	}
	function confirmImport() {
		if (!importPreview || !onRoute() || importRestoring) return;
		importRestoring = true;
		try {
			// Confirmation is the first place import may refresh or write storage.
			// Re-plan against current records so late saves and notes always win.
			store.refresh({ source: 'saved-import' });
			var reviewedCount = importCandidates.length;
			var plan = window.SavedImport.plan(importCandidates, store.snapshot());
			var added = store.restore(plan.additions, { source: 'saved-import' });
			invalidateImport(); render(); storageNotice();
			var message = added ? 'Restored ' + added + (added === 1 ? ' new item.' : ' new items.') : 'No new items needed restoring.';
			if (added < reviewedCount) message = 'Restored ' + added + ' of ' + reviewedCount + ' reviewed additions; the others were already saved.';
			message += ' Existing items and notes were kept.';
			if (!store.status().persistent) message += ' Some saved data is kept only for this visit. Export JSON to keep a copy.';
			announce(message); importButton.focus();
		} catch (error) {
			importError.hidden = false; importError.textContent = 'Restore could not finish. You can retry; existing saved items will be kept.';
		} finally { importRestoring = false; }
	}
	function buildImport(actions) {
		importButton = button('saved-import', 'Import JSON', selectImportFile); importButton.setAttribute('aria-controls', 'saved-import-panel'); actions.insertBefore(importButton, clearButton);
		importFile = node('input'); importFile.type = 'file'; importFile.id = 'saved-import-file'; importFile.accept = '.json,application/json'; importFile.hidden = true;
		importFile.setAttribute('aria-label', 'Choose a Saved items JSON backup'); root.appendChild(importFile);
		importFile.addEventListener('change', readImportFile); importFile.addEventListener('cancel', cancelImport);
		importPanel = node('section', 'saved-import-panel'); importPanel.id = 'saved-import-panel'; importPanel.hidden = true; importPanel.setAttribute('aria-labelledby', 'saved-import-heading');
		importHeading = node('h2', '', 'Review backup'); importHeading.id = 'saved-import-heading'; importHeading.tabIndex = -1; importPanel.appendChild(importHeading);
		importName = node('p', 'saved-import-name'); importPanel.appendChild(importName);
		importPanel.appendChild(node('p', 'saved-import-policy', 'Existing items and notes stay unchanged. Only the additions in this review will be restored. Matching duplicate entries count once; conflicting duplicates are rejected.'));
		importSummary = node('dl', 'saved-import-summary'); importSummary.id = 'saved-import-summary';
		[['additions', 'To add'], ['existing', 'Already saved'], ['duplicates', 'Matching duplicates']].forEach(function (entry) {
			var cell = node('div'); cell.appendChild(node('dt', '', entry[1])); var value = node('dd', '', '0'); value.setAttribute('data-import-count', entry[0]); cell.appendChild(value); importSummary.appendChild(cell);
		}); importPanel.appendChild(importSummary);
		importError = node('p', 'saved-import-error'); importError.id = 'saved-import-error'; importError.setAttribute('role', 'alert'); importError.hidden = true; importPanel.appendChild(importError);
		importList = node('ul', 'saved-import-list'); importList.id = 'saved-import-list'; importPanel.appendChild(importList);
		importRemainder = node('p', 'saved-import-remainder'); importPanel.appendChild(importRemainder);
		var controls = node('div', 'saved-import-actions'); importConfirm = button('saved-import-confirm', 'Restore', confirmImport); importConfirm.disabled = true;
		importCancel = button('saved-import-cancel', 'Cancel', cancelImport); controls.appendChild(importConfirm); controls.appendChild(importCancel); importPanel.appendChild(controls);
		importStatus = node('p', 'saved-import-status'); importStatus.id = 'saved-import-status'; importStatus.setAttribute('role', 'status'); importStatus.setAttribute('aria-live', 'polite'); importPanel.appendChild(importStatus);
		root.appendChild(importPanel);
	}
	function rowFor(item, position) {
		var row = node('li', 'saved-item'); row.setAttribute('data-kind', item.saved.kind); row.setAttribute('data-id', item.saved.id);
		var main = node('div', 'saved-item-main'), link = node('a', 'saved-item-link'); link.href = href(item.entity);
		link.appendChild(node('span', 'saved-item-kind', labelFor(item.saved.kind).label));
		link.appendChild(node('span', 'saved-item-title', item.entity.title)); main.appendChild(link);
		if (item.entity.subtitle) main.appendChild(node('p', 'saved-item-subtitle', item.entity.subtitle));
		if (item.saved.note) {
			var note = node('details', 'saved-item-note'); note.appendChild(node('summary', '', 'Your note'));
			note.appendChild(node('p', '', item.saved.note)); main.appendChild(note);
		}
		row.appendChild(main);
		var remove = button('', 'Remove', function () { removeItem(item.saved, position); }); remove.removeAttribute('id');
		remove.classList.add('saved-remove'); remove.setAttribute('aria-label', 'Remove ' + item.entity.title + ' from saved items'); row.appendChild(remove);
		return row;
	}
	function render() {
		if (!root || !registry) return;
		var active = document.activeElement, activeRow = list.contains(active) && active.closest('.saved-item');
		var focused = activeRow ? { kind: activeRow.getAttribute('data-kind'), id: activeRow.getAttribute('data-id') } : null;
		var wasRemove = !!(active && active.classList.contains('saved-remove'));
		var all = resolved(), words = fold(query).trim().split(/\s+/);
		var visible = all.filter(function (item) {
			if (kind && item.saved.kind !== kind) return false;
			var haystack = fold([item.entity.title, item.entity.subtitle, item.entity.description, item.saved.note, labelFor(item.saved.kind).label].join(' '));
			return words.every(function (word) { return haystack.indexOf(word) !== -1; });
		});
		count.textContent = (kind || query.trim() ? visible.length + ' of ' + all.length : String(all.length)) + (all.length === 1 ? ' saved item' : ' saved items');
		Array.prototype.forEach.call(kindSelect.options, function (option) {
			var label = labelFor(option.value); option.textContent = (label ? label.label : 'All types') + ' (' + all.filter(function (item) { return !option.value || item.saved.kind === option.value; }).length + ')';
		});
		exportButton.disabled = !store.snapshot().length; clearButton.disabled = !all.length;
		retry.hidden = !failures.length;
		var unresolved = store.snapshot().length - all.length;
		missing.hidden = !failures.length && !unresolved;
		missing.textContent = failures.length ? 'Some saved details could not be loaded (' + failures.join(', ') + '). Try again to load them.' :
			unresolved + (unresolved === 1 ? ' saved item could' : ' saved items could') + ' not be matched to current public content. Export JSON includes their IDs and notes.';
		list.textContent = '';
		visible.forEach(function (item, i) { list.appendChild(rowFor(item, i)); });
		if (!visible.length) {
			var empty = node('li', 'saved-empty', all.length ? 'No saved items match these filters.' :
				store.snapshot().length ? 'Saved details are unavailable. You can still export all your saved IDs and notes.' :
				'Save writing or research, star an experiment, or add a book to your reading list.');
			if (all.length) empty.appendChild(button('', 'Clear filters', function () { kind = ''; query = ''; search.value = ''; kindSelect.value = ''; writeState(); render(); search.focus(); }));
			else {
				var links = node('div', 'saved-empty-links');
				[['Research', '#/publications'], ['Writing', '#/blog'], ['Books', '#/bookshelf'], ['Experiments', '#/misc']].forEach(function (entry) {
					var link = node('a', '', entry[0]); link.href = new URL(entry[1], rootUrl).href; links.appendChild(link);
				}); empty.appendChild(links);
			}
			list.appendChild(empty);
		}
		syncUndo(); storageNotice(); updateHeader(); refreshImportReview();
		if (focused && document.activeElement === document.body && !focusItem(focused, wasRemove ? '.saved-remove' : '.saved-item-link')) {
			try { search.focus({ preventScroll: true }); } catch (e) { search.focus(); }
		}
	}
	function ensureRoot() {
		if (root) return true;
		var host = document.querySelector('#savedContent > .container'); if (!host || !store) return false;
		root = node('div', 'saved-hub'); root.id = 'saved-hub';
		root.appendChild(node('h1', 'saved-title', 'Saved items'));
		root.appendChild(node('p', 'saved-intro', 'Writing, research, books, and experiments you want to return to.'));
		notice = node('p', 'saved-storage-note'); root.appendChild(notice);
		var toolbar = node('div', 'saved-toolbar'), searchLabel = node('label', 'saved-search-label', 'Search saved items');
		searchLabel.htmlFor = 'saved-search'; search = node('input'); search.id = 'saved-search'; search.type = 'search'; search.autocomplete = 'off'; search.placeholder = 'Title, author, topic, or your note'; searchLabel.appendChild(search); toolbar.appendChild(searchLabel);
		var typeLabel = node('label', 'saved-kind-label', 'Type'); typeLabel.htmlFor = 'saved-kind'; kindSelect = node('select'); kindSelect.id = 'saved-kind';
		[{ kind: '', label: 'All types' }].concat(TYPES).forEach(function (type) { var option = node('option', '', type.label); option.value = type.kind; kindSelect.appendChild(option); });
		typeLabel.appendChild(kindSelect); toolbar.appendChild(typeLabel); root.appendChild(toolbar);
		var actions = node('div', 'saved-actions'); count = node('p', 'saved-count'); count.id = 'saved-count'; count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); count.setAttribute('aria-atomic', 'true'); actions.appendChild(count);
		exportButton = button('saved-export', 'Export JSON', exportItems); clearButton = button('saved-clear', 'Clear saved items', clear); actions.appendChild(exportButton); actions.appendChild(clearButton); root.appendChild(actions);
		buildImport(actions);
		missing = node('p', 'saved-unresolved'); missing.hidden = true; root.appendChild(missing);
		retry = button('saved-retry', 'Try again', function () { metadataPromise = null; show(); }); retry.hidden = true; root.appendChild(retry);
		undoBar = node('div', 'saved-undo-bar'); undoBar.id = 'saved-undo-bar'; undoBar.hidden = true;
		undoBar.appendChild(node('span', '', 'Removed from saved items. ')); undoButton = button('saved-undo', 'Undo', undo); undoBar.appendChild(undoButton); root.appendChild(undoBar);
		list = node('ul', 'saved-list'); list.id = 'saved-list'; root.appendChild(list);
		status = node('p', 'saved-status'); status.id = 'saved-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
		host.textContent = ''; host.appendChild(root);
		search.addEventListener('input', function () { query = search.value; render(); clearTimeout(urlTimer); urlTimer = setTimeout(writeState, 200); });
		search.addEventListener('keydown', function (event) { if (event.key === 'Escape' && search.value) { search.value = ''; query = ''; writeState(); render(); } });
		kindSelect.addEventListener('change', function () { kind = kindSelect.value; writeState(); render(); });
		return true;
	}
	function show() {
		if (!ensureRoot()) return;
		var request = ++requestId; store.refresh({ source: 'saved-hub' }); readState(); storageNotice();
		root.setAttribute('aria-busy', 'true'); count.textContent = 'Loading saved details...'; exportButton.disabled = !store.snapshot().length; clearButton.disabled = true;
		load().then(function () {
			if (request !== requestId || !onRoute()) return;
			root.removeAttribute('aria-busy'); render();
		}).catch(function () {
			if (request !== requestId || !onRoute()) return;
			root.removeAttribute('aria-busy'); count.textContent = 'Saved details could not be loaded.'; retry.hidden = false;
		});
	}
	window.Saved = { show: show };
	window.addEventListener('hashchange', function () { if (!onRoute() && importPanel && !importPanel.hidden) invalidateImport(); });
	if (store) store.subscribe(function (detail) { updateHeader(); if (detail.source !== 'saved-hub' && root && onRoute()) render(); });
	function boot() { updateHeader(); if (onRoute()) show(); }
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
