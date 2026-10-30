// Pure Saved backup validation and merge planning. No storage, DOM, network or
// imported presentation metadata is used. The UI reviews a plan before restore.
(function (root, factory) {
	'use strict';
	if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./saved-store.js').valid);
	else root.SavedImport = factory(root.SavedStore && root.SavedStore.valid);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (validId) {
	'use strict';
	var MAX_BYTES = 10 * 1024 * 1024;
	var MAX_ITEMS = 10000;
	var KINDS = ['post', 'publication', 'book', 'experiment'];
	var own = Object.prototype.hasOwnProperty;

	function ImportError(errors) {
		this.name = 'SavedImportError';
		this.errors = errors;
		var first = errors[0];
		this.message = (first.row === null ? '' : 'Row ' + first.row + ': ') + first.message +
			(errors.length > 1 ? ' (' + errors.length + ' errors in this backup.)' : '');
		if (Error.captureStackTrace) Error.captureStackTrace(this, ImportError);
	}
	ImportError.prototype = Object.create(Error.prototype);
	ImportError.prototype.constructor = ImportError;

	function problem(row, field, message) { return { row: row, field: field, message: message }; }
	function fail(row, field, message) { throw new ImportError([problem(row, field, message)]); }
	function token(item) { return item.kind + ':' + item.id; }
	function utf8Length(value) {
		var bytes = 0;
		for (var i = 0; i < value.length; i++) {
			var code = value.charCodeAt(i);
			if (code < 0x80) bytes++;
			else if (code < 0x800) bytes += 2;
			else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
			else bytes += 3;
			if (bytes > MAX_BYTES) return bytes;
		}
		return bytes;
	}
	function normalizeRows(rows) {
		if (!Array.isArray(rows)) fail(null, 'items', 'This backup must contain an items array. Use Export JSON in Saved items to create a supported backup.');
		if (rows.length > MAX_ITEMS) fail(null, 'items', 'This backup contains ' + rows.length + ' items. The limit is ' + MAX_ITEMS + '.');
		if (typeof validId !== 'function') fail(null, 'validation', 'Saved item validation is unavailable. Reload the page before trying again.');
		var items = [], duplicates = 0, duplicateRows = [], seen = Object.create(null), errors = [];
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i], number = i + 1, start = errors.length;
			if (!row || typeof row !== 'object' || Array.isArray(row)) {
				errors.push(problem(number, 'item', 'Each item must be an object with a kind and an ID.'));
				continue;
			}
			var knownKind = own.call(row, 'kind') && KINDS.indexOf(row.kind) !== -1;
			if (!knownKind) errors.push(problem(number, 'kind', 'Kind must be post, publication, book, or experiment.'));
			if (!own.call(row, 'id') || typeof row.id !== 'string') errors.push(problem(number, 'id', 'ID must be text.'));
			else if (knownKind && !validId(row.kind, row.id)) errors.push(problem(number, 'id', 'ID is not valid for this kind of saved item. Keep its original catalogue ID or slug.'));
			if (own.call(row, 'note') && typeof row.note !== 'string') errors.push(problem(number, 'note', 'Note must be text, or the note field must be omitted.'));
			if (own.call(row, 'addedAt') && typeof row.addedAt !== 'string') errors.push(problem(number, 'addedAt', 'AddedAt must be text, empty text, or omitted.'));
			if (row.kind === 'experiment') {
				if (typeof row.note === 'string' && row.note !== '') errors.push(problem(number, 'note', 'Experiment favorites store IDs only. A nonempty experiment note cannot be restored; keep it separately before removing this field.'));
				if (typeof row.addedAt === 'string' && row.addedAt !== '') errors.push(problem(number, 'addedAt', 'Experiment favorites store IDs only. A nonempty experiment timestamp cannot be restored; keep it separately before removing this field.'));
			}
			if (errors.length !== start) continue;
			var item = { kind: row.kind, id: row.id };
			if (item.kind !== 'experiment') {
				// Legacy exports can contain unknown/empty date text. It is kept as
				// an annotation and is never interpreted as note-edit freshness.
				item.addedAt = own.call(row, 'addedAt') ? row.addedAt : '';
				if (own.call(row, 'note')) item.note = row.note;
				else if (item.kind === 'book') item.note = '';
			}
			var id = token(item), previous = seen[id];
			if (previous) {
				var note = own.call(item, 'note') ? item.note : '', oldNote = own.call(previous.item, 'note') ? previous.item.note : '';
				var addedAt = own.call(item, 'addedAt') ? item.addedAt : '', oldDate = own.call(previous.item, 'addedAt') ? previous.item.addedAt : '';
				if (note !== oldNote) errors.push(problem(number, 'note', 'This duplicate has a different note from row ' + previous.row + '. Keep one agreed note for this kind and ID.'));
				if (addedAt !== oldDate) errors.push(problem(number, 'addedAt', 'This duplicate has a different addedAt value from row ' + previous.row + '. Keep one agreed value for this kind and ID.'));
				if (errors.length === start) { duplicates++; duplicateRows.push({ row: number, firstRow: previous.row, kind: item.kind, id: item.id }); }
			} else { seen[id] = { item: item, row: number }; items.push(item); }
		}
		if (errors.length) throw new ImportError(errors);
		return { version: 1, items: items, originalCount: rows.length, duplicates: duplicates, duplicateRows: duplicateRows };
	}
	function parse(value) {
		if (typeof value !== 'string') fail(null, 'file', 'Choose a JSON text backup from Saved items.');
		if (value.length > MAX_BYTES || utf8Length(value) > MAX_BYTES) fail(null, 'file', 'This backup is larger than 10 MiB. Choose a smaller Saved items JSON file.');
		var data;
		try { data = JSON.parse(value.charCodeAt(0) === 0xfeff ? value.slice(1) : value); }
		catch (e) { fail(null, 'file', 'This file is not valid JSON. Choose a Saved items JSON backup.'); }
		if (!data || typeof data !== 'object' || Array.isArray(data)) fail(null, 'file', 'This backup must be a JSON object with version 1 and an items array.');
		if (!own.call(data, 'version') || data.version !== 1) fail(null, 'version', 'This backup version is not supported. Expected version 1.');
		if (!own.call(data, 'items')) fail(null, 'items', 'This backup has no items array. Use Export JSON in Saved items to create a supported backup.');
		return normalizeRows(data.items);
	}
	function plan(items, currentSnapshot) {
		var parsed = normalizeRows(items), current = Object.create(null), additions = [], alreadySaved = [];
		(Array.isArray(currentSnapshot) ? currentSnapshot : []).forEach(function (item) {
			if (item && validId(item.kind, item.id)) current[token(item)] = true;
		});
		parsed.items.forEach(function (item) {
			if (current[token(item)]) alreadySaved.push({ kind: item.kind, id: item.id });
			else additions.push(item);
		});
		return { additions: additions, alreadySaved: alreadySaved, additionCount: additions.length,
			alreadySavedCount: alreadySaved.length, total: parsed.items.length, duplicates: parsed.duplicates };
	}
	return { parse: parse, plan: plan, MAX_BYTES: MAX_BYTES, MAX_ITEMS: MAX_ITEMS, SavedImportError: ImportError };
});
