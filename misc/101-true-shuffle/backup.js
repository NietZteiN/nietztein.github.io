/* True Shuffle: preview and undo a backup restore, shared by file pick and drop. */
(function (root) {
	'use strict';
	function confirm(data, name, ctx) {
		var TS = root.TrueShuffle, U = TS.ui, h = U.h, clean;
		try { clean = TS.store.checkExport(data); } catch (e) { ctx.fail(e); return Promise.resolve(); }
		var store = ctx.store(), words = ctx.words;
		return store.usage().then(function (here) {
			var d = U.openDialog({ title: 'Restore this backup?' });
			var date = new Date(data.exportedAt), saved = isFinite(date.getTime()) ? date.toLocaleString() : '';
			var savedLists = Array.isArray(clean.kv.lists) ? clean.kv.lists.length : 0;
			d.body.appendChild(h('p', { text: name + (saved ? ', saved ' + saved : '') + '.' }));
			d.body.appendChild(h('p', { text: 'In the file: ' + words.plural(clean.tracks.length, 'song') + ', ' + words.plural(clean.history.length, 'listen') + ', ' + words.plural(savedLists, 'playlist') + '.' }));
			d.body.appendChild(h('p', { text: 'Here now: ' + words.plural(here.tracks, 'song') + ', ' + words.plural(here.history, 'listen') + ', ' + words.plural(ctx.lists.all().length, 'playlist') + '.' }));
			d.body.appendChild(h('p', { class: 'ts-notice', text: 'This replaces everything stored here: library, labels, corrections, ratings, plays, listening history, playlists and queue. Save what is here first if you want to keep it.' }));
			var replace = U.btn({ label: 'Replace everything', variant: 'danger', on: { click: function () {
				U.btnState(replace, { disabled: true, busy: true });
				store.exportAll(Date.now()).then(function (snapshot) {
					return store.importAll(data, { mode: 'replace' }).then(function () { d.close(); return ctx.reload(); }).then(function () {
						var msg = 'Restored the backup: ' + words.plural(clean.tracks.length, 'song') + ', ' + words.plural(clean.history.length, 'listen') + '.';
						ctx.status(msg);
						U.toast(msg, { action: 'Undo', ms: 15000, onAction: function () {
							store.importAll(snapshot, { mode: 'replace' }).then(ctx.reload).then(function () { ctx.say('Put back what was here before the restore.'); }).catch(ctx.fail);
						} });
					});
				}).catch(function (e) { U.btnState(replace, { disabled: false, busy: false }); ctx.fail(e); });
			} } });
			var cancel = U.btn({ label: 'Cancel', on: { click: d.close } });
			d.body.appendChild(h('div', { class: 'ts-row-btns' }, [replace, U.btn({ label: 'Save what is here first', icon: 'download', on: { click: ctx.exportAll } }), cancel]));
			cancel.focus();
		});
	}
	root.TrueShuffle.backup = { confirm: confirm };
})(window);
