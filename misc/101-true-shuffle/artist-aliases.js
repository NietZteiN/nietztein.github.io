// Artist spellings: a persistent merge, and reversible alias management.
(function (TS) {
	'use strict';
	function snapshot(lib) { return JSON.parse(JSON.stringify(lib.aliases)); }
	function restore(ctx, before) {
		var lib = ctx.lib();
		Object.keys(lib.aliases).forEach(function (k) { delete lib.aliases[k]; });
		Object.keys(before).forEach(function (k) { lib.aliases[k] = before[k]; });
		ctx.changed(ctx.L.deriveAll(lib), true);
	}
	TS.artistAliases = {
		merge: function (ctx, key, artist) {
			var lib = ctx.lib(), L = ctx.L, U = ctx.U, h = ctx.h, w = ctx.words;
			var all = {}, count = 0;
			L.list(lib).forEach(function (t) {
				if (t.artistKey === key) count++;
				if (!t.artist || !t.artistKey || t.artistKey.charAt(0) === '~') return;
				var a = all[t.artistKey] || (all[t.artistKey] = { key: t.artistKey, name: t.artist, count: 0, native: (lib.profiles[t.artistKey] || {}).native || t.artistNative || '' });
				a.count++;
			});
			var candidates = Object.keys(all).map(function (k) { return all[k]; }).filter(function (a) { return a.key !== key && L.people(a.name).length <= 1; });
			var native = artist.native || (lib.profiles[key] || {}).native;
			var picks = candidates.filter(function (a) { return native && a.native && L.normArtist(a.native) === L.normArtist(native); }).sort(function (a, b) { return b.count - a.count; });
			if (TS.fuzzy) TS.fuzzy.rankNames(candidates.map(function (a) { return a.name; }), artist.name, { limit: 5 }).forEach(function (r) { var a = candidates[r.i]; if (picks.indexOf(a) < 0) picks.push(a); });
			var d = U.openDialog({ title: 'Same artist as' + w.ELL });
			d.node.classList.add('ts-alias-dialog');
			d.body.appendChild(h('p', { text: w.q(artist.name) + ' will be listed under the name you pick, now and for songs imported later. ' + w.plural(count, 'song') + ' in your whole library will move.' }));
			var form = h('form', { class: 'ts-edit' }), input = h('input', { class: 'kit-input', type: 'text', list: 'ts-alias-names', autocomplete: 'off', aria: { label: 'List under artist' } });
			form.appendChild(h('label', { class: 'ts-field' }, [h('span', { text: 'List under artist' }), input]));
			var names = h('datalist', { id: 'ts-alias-names' });
			Object.keys(all).filter(function (k) { return k !== key; }).sort().forEach(function (k) { names.appendChild(h('option', { value: all[k].name })); });
			form.appendChild(names);
			if (picks.length) form.appendChild(h('div', { class: 'ts-row-btns' }, picks.slice(0, 5).map(function (a) { return U.btn({ label: a.name + ' ' + w.DOT + ' ' + w.plural(a.count, 'song'), variant: 'secondary', size: 'md', on: { click: function () { input.value = a.name; input.focus(); } } }); })));
			form.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ label: 'Merge', variant: 'primary', size: 'md', type: 'submit' }), U.btn({ label: 'Cancel', variant: 'secondary', size: 'md', on: { click: d.close } })]));
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				var target = input.value.trim();
				if (!target) { input.focus(); return; }
				if (L.artistOf(lib, target).key === key) { ctx.say('That is already this artist.'); input.focus(); return; }
				var before = snapshot(lib), ids = L.declareAliases(lib, [artist.name], target), to = L.artistOf(lib, target);
				ctx.changed(ids, true); d.close(); ctx.nav(ctx.link('artist', to.key));
				U.toast(w.q(artist.name) + ' is now listed as ' + to.name + ': ' + w.plural(count, 'song') + ' moved.', { action: 'Undo', onAction: function () { restore(ctx, before); ctx.nav(ctx.link('artist', key)); ctx.say('Artist spellings restored.'); } });
			});
			d.body.appendChild(form); input.focus();
		},
		settings: function (panel, ctx) {
			var lib = ctx.lib(), h = ctx.h, w = ctx.words, keys = Object.keys(lib.aliases).sort();
			panel.appendChild(h('p', { class: 'ts-muted', text: w.plural(keys.length, 'artist spelling') + ' listed under another name. Manage a merge from the artist page\'s Same artist as action.' }));
			if (!keys.length) return;
			var details = h('details', { class: 'ts-alias-list', data: { id: 'artist-aliases' } }, h('summary', { text: 'Artist spellings' }));
			keys.forEach(function (key) {
				details.appendChild(h('div', { class: 'ts-row-btns' }, [h('span', { style: { flex: '1 1 220px', 'overflow-wrap': 'anywhere' }, text: key + ' \u2192 ' + lib.aliases[key] }), ctx.U.btn({ label: 'Remove', variant: 'secondary', size: 'md', data: { id: 'alias-remove-' + key }, aria: { label: 'Remove artist spelling ' + key }, on: { click: function () {
					var before = snapshot(lib), ids = ctx.L.removeAlias(lib, key);
					ctx.changed(ids, true); ctx.redraw();
					ctx.U.toast('Removed the spelling ' + w.q(key) + '.', { action: 'Undo', onAction: function () { restore(ctx, before); ctx.redraw(); ctx.say('Artist spelling restored.'); } });
				} } })]));
			});
			panel.appendChild(details);
		}
	};
})(window.TrueShuffle);
