/* True Shuffle: reversible corrections. Undo is a fresh change for Desk sync. */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.TrueShuffle.edits = factory();
})(typeof window !== 'undefined' ? window : this, function () {
	'use strict';
	function shared(lib, ids, key) {
		var values = [], seen = {};
		ids.forEach(function (id) {
			var t = lib.tracks[id]; if (!t) return;
			var value = key === 'year' && t.yearSource === 'upload' ? '' : t[key];
			if (value == null) value = key === 'genres' ? [] : '';
			var sig = JSON.stringify(value);
			if (!Object.prototype.hasOwnProperty.call(seen, sig)) { seen[sig] = true; values.push(value); }
		});
		return { mixed: values.length > 1, count: values.length, value: values.length === 1 ? values[0] : null };
	}
	function keep(ctx, ids) {
		var lib = ctx.lib(), L = ctx.L, was = {};
		ids.forEach(function (id) { var t = lib.tracks[id]; if (t) was[id] = { rating: t.rating || 0, likedAt: t.likedAt || null, edits: JSON.parse(JSON.stringify(t.userEdits || {})) }; });
		return function () {
			var back = Object.keys(was).filter(function (id) { return lib.tracks[id]; }), redo = [], byRating = {};
			back.forEach(function (id) {
				var t = lib.tracks[id], w = was[id];
				if ((t.rating || 0) !== w.rating) (byRating[w.rating] = byRating[w.rating] || []).push(id);
				if (JSON.stringify(t.userEdits || {}) !== JSON.stringify(w.edits)) { t.userEdits = JSON.parse(JSON.stringify(w.edits)); redo.push(id); }
			});
			if (redo.length) { L.deriveIds(lib, redo); back = back.concat(L.resolveArtists(lib)); }
			Object.keys(byRating).forEach(function (k) { L.editMany(lib, byRating[k], { rating: +k }); byRating[k].forEach(function (id) { lib.tracks[id].likedAt = was[id].likedAt; }); });
			ctx.changed(back);
			ctx.say('Back as they were.');
		};
	}
	function remove(ctx, ids, close) {
		var lib = ctx.lib(), L = ctx.L, U = ctx.U, h = ctx.h, songs = 0, count = 0;
		ids.forEach(function (id) { var t = lib.tracks[id], n = t ? Object.keys(t.userEdits || {}).length : 0; if (n) { songs++; count += n; } });
		function apply() {
			var undo = keep(ctx, ids), reset = { title: null, artist: null, version: null, year: null, genres: null };
			L.LABEL_FIELDS.forEach(function (k) { reset[k] = null; });
			L.editMany(lib, ids, reset); close(); ctx.changed(ids);
			U.toast('Removed ' + ctx.words.plural(count, 'correction') + ' on ' + ctx.words.plural(songs, 'song') + '.', { action: 'Undo', onAction: undo });
		}
		if (songs < 2) { apply(); return; }
		var d = U.openDialog({ title: 'Remove your corrections?' });
		d.body.appendChild(h('p', { text: 'Remove ' + ctx.words.plural(count, 'correction') + ' on ' + ctx.words.plural(songs, 'song') + '? Their labels and what YouTube says come back. Ratings, plays and blocks stay.' }));
		var cancel = U.btn({ label: 'Keep them', on: { click: d.close } });
		d.body.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ label: 'Remove them', variant: 'danger', on: { click: function () { d.close(); apply(); } } }), cancel]));
		cancel.focus();
	}
	return { keep: keep, remove: remove, shared: shared };
});
