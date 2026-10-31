/* True Shuffle: compare duplicate uploads and choose a shuffle copy, reversibly.
 * The library's version-aware duplicate groups are the only matching authority.
 * No track, playlist, history, rating or YouTube data is removed or rewritten.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(node ? require('./library.js') : root.TrueShuffle.library);
	if (node) module.exports = api;
	else root.TrueShuffle.duplicates = api;
})(typeof window !== 'undefined' ? window : this, function (L) {
	'use strict';
	function groups(lib, tracks) {
		var scope = null;
		if (tracks) { scope = Object.create(null); tracks.forEach(function (t) { scope[typeof t === 'string' ? t : t.id] = true; }); }
		return L.duplicates(lib).map(function (group) {
			var ids = group.ids.filter(function (id) { return !scope || scope[id]; });
			var available = ids.filter(function (id) { return L.playable(lib.tracks[id]); });
			var active = available.filter(function (id) { return !lib.tracks[id].blocked; });
			return { key: group.key, artist: group.artist, title: group.title, version: group.version, ids: ids,
				available: available, active: active, preferred: active.length === 1 ? active[0] : null,
				needsDecision: available.length > 0 && active.length !== 1 };
		}).filter(function (group) { return group.ids.length > 1; });
	}
	function counts(lib, tracks) {
		var all = groups(lib, tracks), needed = all.filter(function (g) { return g.needsDecision; }).length;
		var unavailable = all.filter(function (g) { return !g.available.length; }).length;
		return { all: all.length, needsDecision: needed, resolved: all.length - needed - unavailable,
			unavailable: unavailable, copies: all.reduce(function (n, g) { return n + g.ids.length; }, 0) };
	}
	function stamp(lib, ids, now) {
		var at = typeof now === 'function' ? +now() : Date.now();
		if (!Number.isFinite(at)) at = Date.now();
		ids.forEach(function (id) { var previous = Date.parse(lib.tracks[id] && lib.tracks[id].stateAt); if (Number.isFinite(previous)) at = Math.max(at, previous + 1); });
		return at;
	}
	// Returns null for a stale/mismatched group or an unavailable preferred copy.
	// Undo touches only records changed here, leaving every other field alone.
	function prefer(lib, key, id, opts) {
		opts = opts || {};
		var group = groups(lib, opts.tracks).filter(function (g) { return g.key === key; })[0];
		if (!group || group.ids.indexOf(id) < 0 || !L.playable(lib.tracks[id])) return null;
		var prior = Object.create(null), ids = group.ids.filter(function (copy) { return !!lib.tracks[copy].blocked !== (copy !== id); });
		var at = stamp(lib, ids, opts.now);
		ids.forEach(function (copy) { prior[copy] = !!lib.tracks[copy].blocked; L.edit(lib, copy, { blocked: copy !== id, at: at }); });
		var undone = false;
		return { ids: ids, preferred: id, undo: function () {
			if (undone) return [];
			undone = true;
			var back = ids.filter(function (copy) { return !!lib.tracks[copy]; }), fresh = stamp(lib, back, opts.now);
			back.forEach(function (copy) { L.edit(lib, copy, { blocked: prior[copy], at: fresh }); });
			return back;
		} };
	}
	function availability(track) {
		if (track.removed) return track.removedReason === 'gone' ? 'Removed from YouTube' : 'Removed or private';
		if (track.embeddable === false) return 'Cannot play here';
		if (track.playerError) return 'Player error ' + track.playerError.code;
		return 'Available';
	}
	function view(host, ctx, query) {
		var U = ctx.U, h = ctx.h, lib = ctx.lib(), w = ctx.words;
		var tracks = ctx.idx ? ctx.idx().all : null;
		var all = groups(lib, tracks), showAll = !!(query && query.get('groups') === 'all');
		var shown = showAll ? all : all.filter(function (g) { return g.needsDecision; });
		var total = counts(lib, tracks), box = h('section', { class: 'ts-dupes', aria: { label: 'Duplicate upload review' } });
		box.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Compare uploads of the same song and version. Use this copy in shuffles leaves it allowed and blocks the other copies shown in its group. Nothing is deleted; playlists, plays and stars stay.' }));
		if (tracks && tracks.length < L.list(lib).length) box.appendChild(h('p', { class: 'ts-muted ts-dupe-scope', text: 'Focus limits this review to ' + tracks.length + ' songs. Copies outside Focus stay as they are.' }));
		var tools = h('nav', { class: 'ts-dupes-tools', aria: { label: 'Duplicate groups' } });
		[['Needs a choice', '#/fix?tab=dups', !showAll, total.needsDecision], ['All groups', '#/fix?tab=dups&groups=all', showAll, total.all]].forEach(function (tab) {
			tools.appendChild(h('a', { class: 'ts-chip' + (tab[2] ? ' is-on' : ''), href: tab[1], aria: { current: tab[2] ? 'page' : null } }, [tab[0], h('span', { class: 'ts-count', text: String(tab[3]) })]));
		});
		box.appendChild(tools);
		box.appendChild(h('p', { class: 'ts-dupes-status ts-muted', role: 'status', text: total.needsDecision + (total.needsDecision === 1 ? ' group needs' : ' groups need') + ' a shuffle choice. ' + total.all + (total.all === 1 ? ' group' : ' groups') + ' total.' }));
		if (!shown.length) box.appendChild(h('p', { class: 'ts-empty', text: all.length ? 'No groups need a shuffle choice. All groups lets you review resolved or unavailable copies.' : 'No duplicate uploads in this selection.' }));
		shown.forEach(function (group, index) {
			var heading = 'ts-dupe-heading-' + index;
			var section = h('section', { class: 'ts-dupe-group', data: { id: 'dupe-group-' + group.key }, aria: { labelledby: heading } });
			section.appendChild(h('h2', { id: heading, text: group.title || 'Untitled song' }));
			section.appendChild(h('p', { class: 'ts-dupe-caption ts-muted', text: (group.artist || 'Unknown artist') + ' \u00b7 ' + (group.version || 'Unspecified version') + ' \u00b7 ' + group.ids.length + ' copies' }));
			section.appendChild(h('p', { class: 'ts-dupe-caption', text: !group.available.length ? 'None of these copies can currently play.' : group.active.length === 1 ? 'One available copy is allowed in shuffles.' : group.active.length ? group.active.length + ' copies are allowed in shuffles.' : 'Every available copy is blocked from shuffles.' }));
			var copies = h('div', { class: 'ts-dupe-copies' });
			group.ids.forEach(function (id) {
				var t = lib.tracks[id], available = L.playable(t), isPreferred = group.preferred === id;
				var copy = h('article', { class: 'ts-dupe-copy' + (isPreferred ? ' is-preferred' : '') + (!available ? ' is-unavailable' : ''), data: { id: 'dupe-copy-' + id } });
				copy.appendChild(h('h3', null, h('a', { href: ctx.link('track', id), text: w.title(t) || 'Untitled song' })));
				if (isPreferred) copy.appendChild(h('p', { class: 'ts-dupe-preferred', text: 'Current shuffle copy' }));
				var facts = h('dl', { class: 'ts-dupe-facts' });
				[['Channel', t.channel || 'Unknown channel'], ['Version', t.versionText || t.version || 'Unspecified'], ['Length', t.durationSec ? w.clock(t.durationSec) : 'Unknown'], ['Plays', String(t.plays || 0)], ['Stars', (t.rating || 0) + ' of 5'], ['Availability', availability(t)], ['Shuffle', t.blocked ? 'Blocked' : available ? 'Allowed' : 'Unavailable']].forEach(function (fact) { facts.appendChild(h('div', null, [h('dt', { text: fact[0] }), h('dd', { text: fact[1] })])); });
				copy.appendChild(facts);
				var actions = h('div', { class: 'ts-dupe-actions' });
				actions.appendChild(U.btn({ label: 'Play this copy', icon: 'play', variant: 'secondary', disabled: !available, on: { click: function () { ctx.play.now([id]); } } }));
				var already = !t.blocked && group.ids.every(function (other) { return other === id || lib.tracks[other].blocked; });
				actions.appendChild(U.btn({ label: already ? 'Shuffle choice kept' : 'Use this copy in shuffles', variant: 'primary', disabled: !available || already, on: { click: function () {
					var result = prefer(ctx.lib(), group.key, id, { tracks: ctx.idx ? ctx.idx().all : null });
					if (!result || !result.ids.length) return;
					ctx.changed(result.ids);
					var title = host.querySelector('h1');
					if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
					U.toast('Shuffle copy chosen. Other copies in this group are blocked.', { action: 'Undo', onAction: function () {
						var restored = result.undo();
						if (restored.length) ctx.changed(restored);
						ctx.say('Previous shuffle blocks restored.');
					} });
				} } }));
				copy.appendChild(actions); copies.appendChild(copy);
			});
			section.appendChild(copies); box.appendChild(section);
		});
		host.appendChild(box);
	}
	return { groups: groups, counts: counts, prefer: prefer, view: view };
});
