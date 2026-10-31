/* Local hand-picked playlist editing. Pure ordering helpers are also usable in Node. */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.playlistEditor = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	function same(a, b) { return a.length === b.length && a.every(function (id, i) { return id === b[i]; }); }
	function moveIds(ids, selected, direction, beforeId) {
		var chosen = ids.filter(function (id) { return selected.indexOf(id) >= 0; }), out = ids.slice(), i, hold;
		if (!chosen.length) return out;
		if (direction === 'up' || direction === 'down') {
			for (i = direction === 'up' ? 1 : out.length - 2; direction === 'up' ? i < out.length : i >= 0; direction === 'up' ? i++ : i--) {
				var next = i + (direction === 'up' ? -1 : 1);
				if (chosen.indexOf(out[i]) >= 0 && chosen.indexOf(out[next]) < 0) { hold = out[i]; out[i] = out[next]; out[next] = hold; }
			}
			return out;
		}
		out = ids.filter(function (id) { return chosen.indexOf(id) < 0; });
		var at = direction === 'top' ? 0 : direction === 'before' && out.indexOf(beforeId) >= 0 ? out.indexOf(beforeId) : out.length;
		return out.slice(0, at).concat(chosen, out.slice(at));
	}
	// Keep unavailable IDs in their original slots; only visible songs move.
	function fillVisibleOrder(original, visible) {
		var at = 0;
		return original.map(function (id) { return visible.indexOf(id) >= 0 ? visible[at++] : id; });
	}
	// Restore only this removal, keeping later additions and unrelated removals.
	function restoreRemoved(before, current, removed) {
		var out = current.slice();
		before.forEach(function (id, i) {
			if (removed.indexOf(id) < 0 || out.indexOf(id) >= 0) return;
			var at = -1, k;
			for (k = i + 1; k < before.length; k++) { at = out.indexOf(before[k]); if (at >= 0) break; }
			if (at < 0) { for (k = i - 1; k >= 0; k--) { at = out.indexOf(before[k]); if (at >= 0) { at++; break; } } }
			out.splice(at < 0 ? 0 : at, 0, id);
		});
		return out;
	}
	function moveMenu(U, at, selected, move, order) {
		var items = [];
		[['top', 'To the top'], ['up', 'Up one', 'Alt+Up'], ['down', 'Down one', 'Alt+Down'], ['bottom', 'To the bottom']].forEach(function (row) {
			if (!same(order, moveIds(order, selected, row[0]))) items.push({ label: row[1], hint: row[2], onSelect: function () { move(selected, row[0]); } });
		});
		if (items.length) U.openMenu(at, items, { label: 'Move songs in your order' });
	}
	function open(ctx, li) {
		var U = ctx.U, h = U.h, selected = [], all = ctx.L.list(ctx.lib), d = U.openDialog({ title: 'Add songs to ' + li.name });
		var box = h('div', { class: 'ts-playlist-picker' });
		box.appendChild(h('p', { class: 'ts-muted', text: 'Search your whole local library, including songs outside Focus. This changes only this hand-picked playlist.' }));
		var search = h('input', { class: 'kit-input ts-playlist-search', type: 'search', placeholder: 'Title, artist or work', aria: { label: 'Find songs in your library' } });
		var status = h('p', { class: 'ts-muted ts-playlist-pick-status', role: 'status', aria: { live: 'polite', atomic: 'true' } });
		var results = h('div', { class: 'ts-playlist-results', role: 'group', aria: { label: 'Library songs' } });
		var add = U.btn({ label: 'Add songs', variant: 'primary', on: { click: commit } });
		function count() { U.btnState(add, { disabled: !selected.length, label: selected.length ? 'Add ' + selected.length + (selected.length === 1 ? ' song' : ' songs') : 'Choose songs to add' }); }
		function draw() {
			var found = search.value.trim() ? ctx.L.search(ctx.lib, search.value.trim(), all) : all, shown = found.slice(0, 40);
			while (results.firstChild) results.removeChild(results.firstChild);
			shown.forEach(function (t) {
				var exists = li.ids.indexOf(t.id) >= 0;
				var input = h('input', { type: 'checkbox', checked: selected.indexOf(t.id) >= 0, disabled: exists, data: { id: t.id }, aria: { label: ctx.title(t) + ', ' + ctx.artist(t) + (exists ? ', already added' : '') } });
				input.addEventListener('change', function () { var at = selected.indexOf(t.id); if (input.checked && at < 0) selected.push(t.id); else if (!input.checked && at >= 0) selected.splice(at, 1); count(); });
				results.appendChild(h('label', { class: 'ts-playlist-pick' + (exists ? ' is-added' : '') }, [input, h('span', { class: 'ts-playlist-pick-copy' }, [h('span', { class: 'ts-playlist-pick-title', text: ctx.title(t) }), h('span', { class: 'ts-playlist-pick-artist', text: ctx.artist(t) + (exists ? ' - Already added' : '') })])]));
			});
			status.textContent = found.length ? (found.length > shown.length ? 'Showing ' + shown.length + ' of ' + found.length + ' songs. Refine your search to find more.' : found.length + (found.length === 1 ? ' song found.' : ' songs found.')) : 'No songs match. Try another title or artist.';
			count();
		}
		function finish() { ctx.render(); requestAnimationFrame(function () { var b = document.querySelector('#view .ts-playlist-add'); if (b) b.focus({ preventScroll: true }); }); }
		function commit() {
			var added = selected.filter(function (id) { return !!ctx.lib.tracks[id] && li.ids.indexOf(id) < 0; });
			if (!added.length) { draw(); return; }
			li.ids = li.ids.concat(added); ctx.save(li); d.close(); finish();
			U.toast(added.length + (added.length === 1 ? ' song added to ' : ' songs added to ') + li.name + '.', { action: 'Undo', onAction: function () { li.ids = li.ids.filter(function (id) { return added.indexOf(id) < 0; }); ctx.save(li); ctx.render(); } });
		}
		search.addEventListener('input', draw);
		box.appendChild(search); box.appendChild(status); box.appendChild(results);
		box.appendChild(h('div', { class: 'ts-playlist-picker-actions ts-row-btns' }, [add, U.btn({ label: 'Cancel', variant: 'secondary', on: { click: d.close } })]));
		d.body.appendChild(box); draw(); search.focus();
	}
	return { moveIds: moveIds, fillVisibleOrder: fillVisibleOrder, restoreRemoved: restoreRemoved, moveMenu: moveMenu, open: open };
});
