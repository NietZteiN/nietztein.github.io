// Quick labeller: persistent queue state and fresh application callbacks.
(function (TS) {
	'use strict';
	TS.labellerView = function (view, c) {
		var state = c.state;
		var lib = c.lib;
		var L = c.L;
		var T = c.T;
		var h = c.h;
		var scopeTracks = c.scopeTracks;
		var needsLabel = c.needsLabel;
		var plural = c.plural;
		var actionBtn = c.actionBtn;
		var renderView = c.renderView;
		var suggestFor = c.suggestFor;
		var n = c.n;
		var artFor = c.artFor;
		var DOT = c.DOT;
		var clock = c.clock;
		var playNow = c.playNow;
		var clear = c.clear;
		var MOOD_HUE = c.MOOD_HUE;
		var ELL = c.ELL;
		var guessPicks = c.guessPicks;
		var changed = c.changed;
		var settleChannel = c.settleChannel;
		var Parse = c.Parse;
		var ruleWords = c.ruleWords;
		var q = c.q;
		var say = c.say;
		if (!state.queue) { state.queue = scopeTracks().filter(needsLabel).map(function (t) { return t.id; }); state.at = 0; state.picked = false; }
		var ids = state.queue;
		while (state.at < ids.length && !lib.tracks[ids[state.at]]) state.at++;
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Quick labeller' }));
		if (state.teach) {
			var teach = state.teach, source = lib.tracks[teach.id], plan = L.teachPlan(lib, teach.id, teach.artist);
			if (!source || !plan || !plan.ids.length) state.teach = null;
			else {
				var offer = h('div', { class: 'ts-guessbox', data: { id: 'lab-teach' } });
				offer.appendChild(h('p', { text: plural(plan.ids.length, 'other unsure track') + ' on ' + q(source.channel) + ' could be read ' + ruleWords(plan.rule) + '. Tracks with a sure artist and your corrections stay as they are.' }));
				if (plan.conflicts) offer.appendChild(h('p', { class: 'ts-muted', text: 'Careful: ' + plural(plan.conflicts, 'sure track') + ' on this channel ' + (plan.conflicts === 1 ? 'is' : 'are') + ' written the other way round.' }));
				offer.appendChild(h('div', { class: 'ts-row-btns' }, [
					h('button', { class: 'ts-btn ts-btn--secondary ts-btn--sm', data: { id: 'lab-teach-yes' }, text: plan.ids.length === 1 ? 'Yes, that track' : 'Yes, those ' + plural(plan.ids.length, 'track'), on: { click: function () {
						var current = L.teachPlan(lib, teach.id, teach.artist), res = current && L.teachChannel(lib, current);
						state.teach = null;
						if (res) { changed(res.touched, true); say(plural(res.ids.length, 'track') + ' from ' + q(source.channel) + ' now read ' + ruleWords(current.rule) + '.'); }
						renderView(false);
					} } }),
					h('button', { class: 'ts-btn ts-btn--secondary ts-btn--sm', data: { id: 'lab-teach-no' }, text: 'No', on: { click: function () { state.teach = null; renderView(false); } } })
				]));
				view.appendChild(offer);
			}
		}
		if (!ids.length || state.at >= ids.length) {
			view.appendChild(h('p', { class: 'ts-empty', text: ids.length ? 'Done: ' + plural(ids.length, 'song') + ' labelled or skipped.' : 'Every song here has labels. Songs you import later land here; you can also select songs anywhere and choose Label them one by one.' }));
			view.appendChild(h('div', { class: 'ts-row-btns' }, [actionBtn('rotate', 'Start over with what is left', function () { state.queue = null; renderView(false); })]));
			return;
		}
		var t = lib.tracks[ids[state.at]];
		if (!t) { state.at++; renderView(true); return; }
		var sg = suggestFor(t);
		var fields = { artist: t.artist || '', title: t.title, genres: t.genres.filter(function (g) { return T.genre(g); }), mood: t.mood || '', scene: t.scene || '', work: t.work || '', role: t.role || '', lang: t.lang || '', kind: t.kind || '' };
		view.appendChild(h('p', { class: 'ts-muted', text: (state.at + 1) + ' of ' + n(ids.length) + '. Keys: 1 to 6 set the mood, Enter saves and goes on, the right arrow skips, the left arrow goes back, P plays.' }));
		var card2 = h('div', { class: 'ts-labelcard' });
		var head = h('div', { class: 'ts-labelhead' });
		head.appendChild(artFor(t, 'ts-label-art'));
		var tx = h('div');
		tx.appendChild(h('p', { class: 'ts-kicker', text: 'On YouTube' }));
		tx.appendChild(h('h2', { class: 'ts-now-title', text: t.raw.title }));
		tx.appendChild(h('p', { class: 'ts-muted', text: t.channel + (t.durationSec ? ' ' + DOT + ' ' + clock(t.durationSec) : '') }));
		tx.appendChild(h('div', { class: 'ts-row-btns' }, [actionBtn('play', 'Play it', function () { playNow([t.id]); })]));
		head.appendChild(tx);
		card2.appendChild(head);
		var g2 = h('div', { class: 'ts-edit-grid' });
		var pairs = guessPicks(t), picks = pairs.map(function (p) { return p[0]; }), inputs = {}, titleEdited = false;
		function readingOf(name) { var folded = Parse.fold(name); return pairs.filter(function (p) { return Parse.fold(p[0]) === folded; })[0] || null; }
		function text(key, label, list) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'text', value: fields[key], autocomplete: 'off', spellcheck: 'false' });
			inputs[key] = inp;
			inp.addEventListener('input', function () { fields[key] = inp.value; if (key === 'title') titleEdited = true; });
			lab.appendChild(inp);
			if (list && list.length) {
				var sug = h('div', { class: 'ts-chips is-tight' });
				list.forEach(function (v) { sug.appendChild(h('button', { class: 'ts-chip is-small', text: v, on: { click: function () {
					inp.value = v; fields[key] = v;
					if (key === 'artist' && inputs.title && !titleEdited) { var reading = readingOf(v); fields.title = inputs.title.value = reading && reading[1] ? reading[1] : t.title; }
				} } })); });
				lab.appendChild(sug);
			}
			g2.appendChild(lab);
			return inp;
		}
		var first = text('artist', 'Artist', picks.concat(sg.artists).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 4));
		text('title', 'Title');
		text('work', 'From (anime, game, musical)', sg.works);
		function chipsRow(label, key, rows, multi, hueFn) {
			var box = h('div', { class: 'ts-field is-wide' }, [h('span', { text: label })]);
			var row = h('div', { class: 'ts-chips is-tight' });
			rows.forEach(function (r, i) {
				var on = multi ? fields[key].indexOf(r[0]) >= 0 : fields[key] === r[0];
				var b = h('button', { data: { id: 'lab-' + key + '-' + r[0] }, class: 'ts-chip' + (on ? ' is-on' : '') + (hueFn ? ' is-hued' : ''), aria: { pressed: on ? 'true' : 'false' } }, [h('span', { text: (key === 'mood' ? (i + 1) + ' ' : '') + r[1] })]);
				if (hueFn) { var hu = hueFn(r[0]); b.style.setProperty('--h', String(hu.h)); b.style.setProperty('--s', hu.s + '%'); }
				b.addEventListener('click', function (ev) {
					if (multi) { var at = fields[key].indexOf(r[0]); if (at >= 0) fields[key].splice(at, 1); else { if (fields[key].length >= 3) fields[key].pop(); fields[key].push(r[0]); } }
					else fields[key] = fields[key] === r[0] ? '' : r[0];
					redraw(); var back = ev.detail ? view.querySelector('h1') : dyn.querySelector('[data-id="' + CSS.escape('lab-' + key + '-' + r[0]) + '"]'); if (back) { if (ev.detail) back.setAttribute('tabindex', '-1'); back.focus({ preventScroll: true }); }
				});
				row.appendChild(b);
			});
			box.appendChild(row);
			return box;
		}
		var dyn = h('div', { class: 'ts-labeldyn' });
		function redraw() {
			clear(dyn);
			dyn.appendChild(chipsRow('Mood', 'mood', T.MOODS, false, function (k) { return { h: MOOD_HUE[k], s: 60 }; }));
			var gs = sg.genres.slice();
			fields.genres.forEach(function (g) { if (gs.indexOf(g) < 0) gs.push(g); });
			var gbox = chipsRow('Genres (suggested first; up to three)', 'genres', gs.map(function (g) { return [g, g]; }), true, function (k) { return T.hueOf(k); });
			var more = h('select', { class: 'kit-input ts-more-genre', aria: { label: 'Another genre' } });
			more.appendChild(h('option', { value: '', text: 'Another genre' + ELL }));
			T.FAMILIES.forEach(function (f) { var og = h('optgroup', { label: f.name }); f.list.forEach(function (g) { og.appendChild(h('option', { value: g.name, text: g.name })); }); more.appendChild(og); });
			more.addEventListener('change', function () { if (more.value && fields.genres.indexOf(more.value) < 0) { if (fields.genres.length >= 3) fields.genres.pop(); fields.genres.push(more.value); } redraw(); dyn.querySelector('.ts-more-genre').focus(); });
			gbox.appendChild(more);
			dyn.appendChild(gbox);
			var scenes = T.SCENES.slice().sort(function (a, b) { return (sg.scenes.indexOf(b[0]) >= 0) - (sg.scenes.indexOf(a[0]) >= 0); });
			dyn.appendChild(chipsRow('Scene', 'scene', scenes, false));
			dyn.appendChild(chipsRow('Role', 'role', T.ROLES, false));
			dyn.appendChild(chipsRow('Language', 'lang', T.LANGS, false));
			dyn.appendChild(chipsRow('Kind', 'kind', T.KINDS, false));
		}
		redraw();
		card2.appendChild(g2);
		card2.appendChild(dyn);
		var btns = h('div', { class: 'ts-row-btns' });
		function save() {
			var out = {};
			['artist', 'title', 'work'].forEach(function (k) { var v = String(fields[k] || '').trim(); if (v !== String(t[k] || '')) out[k] = v || null; });
			['mood', 'scene', 'role', 'lang', 'kind'].forEach(function (k) { if (fields[k] !== (t[k] || '')) out[k] = fields[k]; });
			if (fields.genres.join('|') !== t.genres.join('|') && fields.genres.length) out.genres = fields.genres.slice();
			if (!out.mood && !t.mood && fields.mood) out.mood = fields.mood;
			out.kind = fields.kind || 'song';
			var wasGuess = !t.artist && !!t.artistGuess;
			if (out.artist && wasGuess && !('title' in out) && !titleEdited) { var reading = readingOf(out.artist); if (reading && reading[1]) out.title = reading[1]; }
			L.edit(lib, t.id, out);
			var settled = out.artist && wasGuess ? settleChannel(t.id) : [];
			changed([t.id].concat(settled));
			if (out.artist && wasGuess) state.teach = { id: t.id, artist: out.artist };
			state.at++;
			renderView(false);
		}
		btns.appendChild(actionBtn('check', 'Save and next', save, true));
		btns.appendChild(actionBtn('fwd', 'Skip', function () { state.at++; renderView(false); }));
		if (state.at > 0) btns.appendChild(actionBtn('back', 'Back', function () { state.at--; renderView(false); }));
		card2.appendChild(btns);
		view.appendChild(card2);
		c.keys(function (e) {
			var tag = (e.target && e.target.tagName) || '';
			if (/^(BUTTON|A|SUMMARY|SELECT|TEXTAREA)$/.test(tag) || !(e.target.closest && e.target.closest('#view'))) return false;
			if (tag === 'INPUT' && e.key !== 'Enter') return false;
			if (e.key >= '1' && e.key <= '6') { fields.mood = T.MOODS[+e.key - 1][0]; redraw(); return true; }
			if (e.key === 'Enter') { save(); return true; }
			if (e.key === 'ArrowRight') { state.at++; renderView(false); return true; }
			if (e.key === 'ArrowLeft' && state.at > 0) { state.at--; renderView(false); return true; }
			if (e.key === 'p' || e.key === 'P') { playNow([t.id]); return true; }
			return false;
		});
		if (first && !fields.artist) first.focus();
	};
})(window.TrueShuffle);
