// Mix builder: fresh state and application callbacks supplied on each render.
(function (TS) {
	'use strict';
	TS.mixView = function (view, c) {
		var idx = c.idx;
		var noMusic = c.noMusic;
		var draft = c.draft;
		var h = c.h;
		var clear = c.clear;
		var chosenTracks = c.chosenTracks;
		var plural = c.plural;
		var DOT = c.DOT;
		var longTime = c.longTime;
		var secs = c.secs;
		var modeName = c.modeName;
		var mixWords = c.mixWords;
		var actionBtn = c.actionBtn;
		var patchOf = c.patchOf;
		var editingList = c.editingList;
		var listById = c.listById;
		var saveLists = c.saveLists;
		var focus = c.focus;
		var setFocus = c.setFocus;
		var say = c.say;
		var q = c.q;
		var link = c.link;
		var createList = c.createList;
		var suggestName = c.suggestName;
		var renderView = c.renderView;
		var sectionHead = c.sectionHead;
		var ORDER = c.ORDER;
		var modeInfo = c.modeInfo;
		var icon = c.icon;
		var T = c.T;
		var familyHue = c.familyHue;
		var MOOD_HUE = c.MOOD_HUE;
		var n = c.n;
		var expanded = c.expanded;
		var addedHue = c.addedHue;
		var addedName = c.addedName;
		var L = c.L;
		var lib = c.lib;
		var now = c.now;
		var selectOf = c.selectOf;
		var scopeTracks = c.scopeTracks;
		var S = c.S;
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Mix builder' }));
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Pick what goes in and how it is ordered. Within one row the choices are alternatives (City pop or Anison pop); different rows must all hold (and wistful, and Japanese).' }));
		var summary = h('div', { class: 'ts-mixsum', aria: { live: 'polite' } });
		view.appendChild(summary);
		function refresh() {
			clear(summary);
			var chosen = chosenTracks(draft);
			summary.appendChild(h('p', { class: 'ts-mixsum-n' }, [h('b', { text: plural(chosen.length, 'song') }), ' ' + DOT + ' ' + longTime(secs(chosen)) + ' ' + DOT + ' ' + modeName(draft.mode)]));
			var all = selectOf(draft); all.includeBlocked = true; all.includeUnplayable = true;
			var out = S.select(scopeTracks(), all, now()).length - chosen.length, words = mixWords(draft);
			summary.appendChild(h('p', { class: 'ts-muted', text: (words || 'Everything (no clips).') + (out ? ' ' + plural(out, 'song') + ' left out: blocked or cannot play.' : '') }));
			var row = h('div', { class: 'ts-row-btns' });
			var go = actionBtn('play', 'Play this mix', function () { c.play(draft); }, true);
			go.disabled = !chosen.length;
			row.appendChild(go);
			var editing = editingList && listById(editingList);
			if (editing) row.appendChild(actionBtn('check', 'Update ' + editing.name, function () { editing.patch = patchOf(draft); editing.mode = draft.mode; delete editing.auto; saveLists(); if (focus === editing.id) setFocus(editing.id, true); say('Updated ' + q(editing.name) + '.'); location.hash = link('list', editing.id); }));
			row.appendChild(actionBtn('plus', editing ? 'Save as a new playlist' : 'Save as playlist', function () { createList('smart', { patch: patchOf(draft), mode: draft.mode }, suggestName(draft), { focus: false }); }));
			var reset = actionBtn('close', 'Start over', function () { c.reset(); }); reset.dataset.id = 'mix-reset'; row.appendChild(reset);
			summary.appendChild(row);
		}
		// order
		sectionHead(view, 'Order');
		var modes = h('div', { class: 'ts-modes', role: 'radiogroup', aria: { label: 'Order' } });
		ORDER.forEach(function (o) {
			var m = modeInfo(o.key), on = draft.mode === o.key;
			var b = h('button', { data: { id: 'mix-mode-' + o.key }, class: 'ts-modecard' + (on ? ' is-on' : ''), role: 'radio', aria: { checked: on ? 'true' : 'false' } }, [icon(o.icon), h('b', { text: modeName(o.key) }), h('span', { text: m.blurb })]);
			b.addEventListener('click', function () { draft.mode = o.key; renderView(true); });
			modes.appendChild(b);
		});
		view.appendChild(modes);
		// filters
		function pickRow(title, key, entries, opts) {
			opts = opts || {};
			entries = entries.filter(function (e) { return e.count; });
			if (!entries.length) return;
			var box = h('div', { class: 'ts-pickrow' });
			var hd = h('div', { class: 'ts-pick-h' }, [h('h3', { text: title })]);
			if (draft[key].length) hd.appendChild(h('button', { class: 'ts-link-btn', text: 'Clear', on: { click: function () { draft[key] = []; renderView(true); var back = view.querySelector('.ts-chip[data-id^="mix-' + key + '-"]'); if (back) back.focus({ preventScroll: true }); } } }));
			box.appendChild(hd);
			var row = h('div', { class: 'ts-chips' });
			var shown = opts.max && !opts.all ? entries.slice(0, opts.max) : entries;
			entries.forEach(function (e) { if (draft[key].indexOf(e.key) >= 0 && shown.indexOf(e) < 0) shown.push(e); });
			shown.forEach(function (e) {
				var on = draft[key].indexOf(e.key) >= 0;
				var c = h('button', { data: { id: 'mix-' + key + '-' + e.key }, class: 'ts-chip' + (on ? ' is-on' : '') + (e.hue ? ' is-hued' : ''), aria: { pressed: on ? 'true' : 'false' } }, [h('span', { text: e.name }), h('span', { class: 'ts-count', text: n(e.count) })]);
				if (e.hue) { c.style.setProperty('--h', String(Math.round(e.hue.h))); c.style.setProperty('--s', e.hue.s + '%'); }
				c.addEventListener('click', function () { var at = draft[key].indexOf(e.key); if (at >= 0) draft[key].splice(at, 1); else draft[key].push(e.key); renderView(true); });
				row.appendChild(c);
			});
			if (opts.max && entries.length > shown.length) row.appendChild(h('button', { class: 'ts-link-btn', text: 'and ' + n(entries.length - shown.length) + ' more', on: { click: function () { var first = entries.filter(function (x) { return shown.indexOf(x) < 0; })[0]; opts.all = true; expanded[key] = true; renderView(true); var back = view.querySelector('[data-id="' + CSS.escape('mix-' + key + '-' + first.key) + '"]'); if (back) back.focus({ preventScroll: true }); } } }));
			box.appendChild(row);
			view.appendChild(box);
		}
		sectionHead(view, 'What goes in');
		pickRow('Families', 'families', T.FAMILIES.map(function (f) { return { key: f.key, name: f.name, count: ix.families[f.key] ? ix.families[f.key].tracks.length : 0, hue: familyHue(f.key) }; }));
		var gnames = Object.keys(ix.genres).sort(function (a, b) { return ix.genres[b].tracks.length - ix.genres[a].tracks.length; });
		pickRow('Genres', 'genres', gnames.map(function (g) { return { key: g, name: g, count: ix.genres[g].tracks.length, hue: T.hueOf(g) }; }), { max: 24, all: expanded.genres });
		pickRow('Moods', 'moods', T.MOODS.map(function (m) { return { key: m[0], name: m[1], count: ix.moods[m[0]] ? ix.moods[m[0]].tracks.length : 0, hue: { h: MOOD_HUE[m[0]], s: 60 } }; }));
		pickRow('Scenes', 'scenes', T.SCENES.map(function (s) { return { key: s[0], name: s[1], count: ix.scenes[s[0]] ? ix.scenes[s[0]].tracks.length : 0 }; }));
		pickRow('Languages', 'langs', T.LANGS.map(function (l) { return { key: l[0], name: l[1], count: ix.langs[l[0]] ? ix.langs[l[0]].tracks.length : 0 }; }));
		pickRow('Roles', 'roles', T.ROLES.map(function (r) { return { key: r[0], name: r[1], count: ix.all.filter(function (t) { return t.role === r[0]; }).length }; }));
		var rating = h('div', { class: 'ts-pickrow' }), rh = h('div', { class: 'ts-pick-h' }, h('h3', { text: 'Rating' }));
		if (draft.minRating > 0) rh.appendChild(h('button', { class: 'ts-link-btn', text: 'Clear', on: { click: function () { draft.minRating = 0; renderView(true); var back = view.querySelector('[data-id="mix-rating-4"]'); if (back) back.focus(); } } }));
		rating.appendChild(rh);
		var ratings = h('div', { class: 'ts-chips' });
		[4, 3].forEach(function (v) {
			var on = draft.minRating === v, count = ix.all.filter(function (t) { return (t.rating || 0) >= v; }).length;
			ratings.appendChild(h('button', { data: { id: 'mix-rating-' + v }, class: 'ts-chip' + (on ? ' is-on' : ''), aria: { pressed: on ? 'true' : 'false' }, on: { click: function () { draft.minRating = on ? 0 : v; renderView(true); } } }, [h('span', { text: v === 4 ? 'Liked (4 stars or more)' : '3 stars or more' }), h('span', { class: 'ts-count', text: n(count) })]));
		});
		rating.appendChild(ratings); view.appendChild(rating);
		pickRow('Added in (year)', 'added', Object.keys(ix.addedY).sort().reverse().map(function (y) { return { key: y, name: y, count: ix.addedY[y].tracks.length, hue: addedHue(y) }; }));
		var pickedYears = draft.added.filter(function (k) { return k.length === 4; });
		var monthKeys = Object.keys(ix.addedM).sort().reverse().filter(function (k) { return !pickedYears.length || pickedYears.indexOf(k.slice(0, 4)) >= 0 || draft.added.indexOf(k) >= 0; });
		pickRow(pickedYears.length ? 'Added in (month of ' + pickedYears.join(', ') + ')' : 'Added in (month)', 'added', monthKeys.map(function (k) { return { key: k, name: addedName(k), count: ix.addedM[k].tracks.length }; }), { max: 12, all: expanded.added });
		pickRow('Decades', 'decades', Object.keys(ix.decades).sort().map(function (dk) { return { key: dk, name: dk, count: ix.decades[dk].tracks.length }; }));
		var fl = L.facets(lib, ix.all, now());
		pickRow('Length', 'lengths', fl.length.map(function (e) { return { key: e.key, name: e.name, count: e.count }; }));
		pickRow('Works', 'works', Object.keys(ix.works).sort(function (a, b) { return ix.works[b].tracks.length - ix.works[a].tracks.length; }).map(function (w) { return { key: w, name: w, count: ix.works[w].tracks.length }; }), { max: 18, all: expanded.works });
		pickRow('Artists', 'artists', Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).sort(function (a, b) { return b.tracks.length - a.tracks.length; }).map(function (a) { return { key: a.key, name: a.name, count: a.tracks.length }; }), { max: 24, all: expanded.artists });
		if (Object.keys(lib.playlists).length > 1) pickRow('Playlists', 'playlists', fl.playlist.map(function (e) { return { key: e.key, name: e.name, count: e.count }; }));
		// limits
		sectionHead(view, 'Limits');
		var lim = h('div', { class: 'ts-limits' });
		function num(label, key, hint) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'number', min: '0', placeholder: hint });
			inp.value = draft[key] || '';
			inp.addEventListener('change', function () { var v = parseInt(inp.value, 10); draft[key] = v > 0 ? v : null; if (!(v > 0)) inp.value = ''; refresh(); });
			lab.appendChild(inp);
			lim.appendChild(lab);
		}
		num('Stop after (tracks)', 'maxTracks', 'no limit');
		num('Stop after (minutes)', 'maxMinutes', 'no limit');
		num('Skip what played in the last (hours)', 'hours', 'none');
		function day(label, key) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'date' });
			inp.value = draft[key] || '';
			inp.addEventListener('change', function () { draft[key] = inp.value || ''; refresh(); });
			lab.appendChild(inp);
			lim.appendChild(lab);
		}
		day('Added on or after', 'addedFrom');
		day('Added on or before', 'addedTo');
		var text = h('input', { class: 'kit-input', type: 'search', placeholder: 'any', value: draft.text || '', aria: { label: 'Words in the title, artist or anime' } });
		text.addEventListener('input', function () { draft.text = text.value.trim(); refresh(); });
		lim.appendChild(h('label', { class: 'ts-field' }, [h('span', { text: 'Words in the title, artist or anime' }), text]));
		function check(label, key) {
			var lab = h('label', { class: 'ts-check' });
			var cb = h('input', { type: 'checkbox', checked: !!draft[key] });
			cb.addEventListener('change', function () { draft[key] = cb.checked; refresh(); });
			lab.appendChild(cb);
			lab.appendChild(h('span', { text: label }));
			lim.appendChild(lab);
		}
		check('Keep numbered parts together (Pt. 1, Pt. 2)', 'keepRuns');
		check('Include clips (videos that are not music)', 'clips');
		check('Keep songs from one anime or game apart (all orders but the true shuffle)', 'apart');
		check('One version of each song (the original or one cover, not all of them)', 'oneVersion');
		view.appendChild(lim);
		refresh();
	};
})(window.TrueShuffle);
