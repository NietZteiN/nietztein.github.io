// Confirm destructive playlist actions before application state changes.
(function (TS) {
	'use strict';
	var U = TS.ui, h = U.h;
	function confirm(title, text, label, commit) {
		var d = U.openDialog({ title: title });
		d.body.appendChild(h('p', { text: text }));
		var no = U.btn({ label: 'Keep it', variant: 'secondary', on: { click: d.close } });
		d.body.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ label: label, variant: 'danger', on: { click: function () { d.close(); commit(); } } }), no]));
		no.focus();
	}
	function remove(ctx, p) {
		var w = ctx.words, held = {}, lib = ctx.lib;
		ctx.lists.forEach(function (li) { if (li.kind === 'manual') (li.ids || []).forEach(function (id) { held[id] = true; }); });
		Object.keys(ctx.songPrefs).forEach(function (id) { held[id] = true; });
		var keep = function (id) { return !!held[id]; };
		var total = TS.library.list(lib).filter(function (t) { return t.playlists.indexOf(p.id) >= 0; }).length;
		var count = TS.library.orphansOf(lib, p.id, keep).length;
		confirm('Remove ' + w.q(p.title || p.id) + ' from the library?', w.n(count) + ' of its ' + w.plural(total, 'song') + ' will be deleted from this browser: the ones in no other YouTube playlist that you never played, rated, tagged, corrected, trimmed or put in a hand-picked playlist. ' + w.n(total - count) + ' stay. Nothing changes on YouTube; importing the list again brings them back.', count ? 'Remove and delete ' + w.plural(count, 'song') : 'Remove', function () { ctx.commit(keep); });
	}
	function deleteList(li, w, commit) {
		var count = li.kind === 'manual' ? (li.ids || []).length : 0;
		if (!count) { commit(); return; }
		var opener = document.querySelector('#view .ts-actions [data-label="More actions"]');
		if (opener) opener.focus();
		confirm('Delete ' + w.q(li.name) + '?', w.plural(count, 'hand-picked song') + '. The songs stay in your library; only the playlist goes.', 'Delete playlist', commit);
	}
	TS.playlistActions = { remove: remove, delete: deleteList };
})(window.TrueShuffle);
