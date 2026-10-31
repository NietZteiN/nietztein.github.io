// One artist identity, with local songs, a catalog, releases and related artists.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(root);
	else root.TrueShuffle.artistHub = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';
	function subject(lib, L, key, name) {
		key = L.normArtist(key || name); var alias = lib.aliases[key];
		if (alias) { name = alias; key = L.normArtist(alias); }
		var names = Object.create(null), creditName = '', tracks = L.list(lib).filter(function (t) {
			if (!t.artist) return false;
			var exact = L.artistOf(lib, t.artist).key === key;
			var credited = !exact && L.people(t.artist).some(function (p) { if (p.as === 'character' || L.artistOf(lib, p.name).key !== key) return false; if (!creditName) creditName = L.artistOf(lib, p.name).name; return true; });
			if (exact) names[t.artist] = (names[t.artist] || 0) + 1;
			return exact || credited;
		});
		var best = Object.keys(names).sort(function (a, b) { return names[b] - names[a]; })[0];
		return { key: key, name: alias || best || creditName || String(name || key), tracks: tracks, native: (lib.profiles[key] || {}).native || '', plays: tracks.reduce(function (n, t) { return n + (t.plays || 0); }, 0) };
	}
	function href(name, L, tab, extra) {
		var q = new URLSearchParams(); q.set('artist', name); q.set('tab', tab || 'library');
		Object.keys(extra || {}).forEach(function (key) { if (extra[key] !== '' && extra[key] != null) q.set(key, String(extra[key])); });
		return '#/artist/' + encodeURIComponent(L.normArtist(name)) + '?' + q.toString();
	}
	function view(el, ctx, parts, query, hooks) {
		hooks = hooks || {}; var TS = root.TrueShuffle, h = ctx.h, U = ctx.U, L = ctx.L, lib = ctx.lib();
		var a = subject(lib, L, parts[0], query.get('artist')), key = a.key;
		if (!key) { el.appendChild(h('h1', { class: 'ts-h1', text: 'Choose an artist' })); el.appendChild(h('a', { href: '#/for-you', text: 'Find an artist' })); return; }
		var tab = query.get('tab') || 'library'; if (['library', 'catalog', 'releases', 'related'].indexOf(tab) < 0) tab = 'library';
		var scope = Object.create(null); ctx.idx().all.forEach(function (t) { scope[t.id] = true; });
		var visible = query.get('all') === '1' ? a.tracks : a.tracks.filter(function (t) { return scope[t.id]; });
		var playable = visible.filter(function (t) { return L.playable(t) && !t.blocked; });
		var seed = a.tracks[0], family = seed && ctx.T.trackFamily(seed), f = ctx.T.family(family || 'other') || { hue: 170, sat: 40 };
		var queue = { label: a.name, href: href(a.name, L), patch: { artists: [key] } };
		var actions = [], play = U.btn({ icon: 'play', label: 'Play', variant: 'primary', disabled: !playable.length, on: { click: function () { ctx.play.from(playable.map(function (t) { return t.id; }), 0, queue); } } });
		if (a.tracks.length) {
			actions.push(play);
			actions.push(U.btn({ icon: 'shuffle', label: 'Shuffle', variant: 'secondary', disabled: !playable.length, on: { click: function () { if (hooks.shuffle) hooks.shuffle(Object.assign({}, a, { tracks: playable })); } } }));
			actions.push(U.btn({ icon: 'radio', label: 'Artist radio', variant: 'secondary', disabled: !playable.length, on: { click: function () { if (hooks.radio) hooks.radio(Object.assign({}, a, { tracks: playable })); } } }));
			if (hooks.edit) actions.push(U.btn({ icon: 'edit', label: 'Edit all', variant: 'secondary', on: { click: function () { hooks.edit(a); } } }));
			if (hooks.merge && key.charAt(0) !== '~') actions.push(U.btn({ icon: 'artist', label: 'Same artist as' + ctx.words.ELL, variant: 'secondary', on: { click: function () { hooks.merge(a); } } }));
			if (hooks.scope) actions = actions.concat(hooks.scope(a));
		}
		ctx.ui.headerBlock(el, { round: true, kicker: 'Artist', title: a.name, alt: a.native, hue: { h: f.hue, s: f.sat || 40 }, artNode: seed ? ctx.art(seed, 'ts-hero-art is-round') : U.swatch(f.hue, a.name, 'ts-hero-art is-round'), meta: a.tracks.length ? ctx.words.plural(a.tracks.length, 'song') + ' saved' + (visible.length !== a.tracks.length ? ' / ' + visible.length + ' inside Focus' : '') : 'Explore their music and save what you like', actions: actions });
		var tabs = h('nav', { class: 'ts-artist-hub-tabs', aria: { label: 'Artist sections for ' + a.name } });
		tabs.appendChild(h('span', { class: 'ts-artist-hub-name', text: a.name }));
		[['library', 'In your library'], ['catalog', 'Full catalog'], ['releases', 'Release inbox'], ['related', 'Related artists']].forEach(function (choice) {
			tabs.appendChild(h('a', { href: href(a.name, L, choice[0]), class: 'ts-chip' + (choice[0] === tab ? ' is-on' : ''), text: choice[1], aria: { current: choice[0] === tab ? 'page' : null } }));
		}); el.appendChild(tabs);
		var body = h('section', { class: 'ts-artist-hub-body' }); el.appendChild(body);
		if (tab === 'catalog') {
			var catalogQuery = new URLSearchParams(query.toString()); catalogQuery.set('artist', a.name); catalogQuery.set('tab', 'catalog');
			TS.artistDiscovery(body, ctx, catalogQuery, { embedded: true, base: '#/artist/' + encodeURIComponent(key), artist: a.name }); return;
		}
		if (tab === 'releases') { TS.discoveryShelf.inbox(body, ctx, { artist: a.name, embedded: true, query: query, base: '#/artist/' + encodeURIComponent(key) }); return; }
		if (tab === 'related') {
			var local = Object.keys(ctx.idx().artists).map(function (k) { return ctx.idx().artists[k]; }).filter(function (b) { return b.key !== key && (b.family === family || b.tracks.some(function (t) { return a.tracks.some(function (ours) { return (ours.genres || []).some(function (g) { return (t.genres || []).indexOf(g) >= 0; }); }); })); }).slice(0, 12);
			if (local.length) {
				ctx.ui.sectionHead(body, 'From your library'); var cards = h('div', { class: 'ts-grid is-cards' });
				local.forEach(function (b) { cards.appendChild(ctx.ui.card({ href: href(b.name, L), title: b.name, sub: ctx.words.plural(b.tracks.length, 'song') + ' saved', art: ctx.art(b.tracks[0]) })); }); body.appendChild(cards);
			}
			TS.explore.section(body, ctx, TS.explore.artistSeed(a), ['similar']); return;
		}
		ctx.ui.sectionHead(body, 'Saved songs');
		if (visible.length !== a.tracks.length) body.appendChild(h('a', { class: 'ts-artist-launch-link', href: href(a.name, L, 'library', { all: '1' }), text: 'Show all ' + a.tracks.length + ' saved songs by this artist' }));
		if (!visible.length) body.appendChild(h('p', { class: 'ts-empty', text: a.tracks.length ? 'No songs by this artist inside Focus. Show all saved songs or open Full catalog.' : 'No songs saved yet. Open Full catalog to discover their music.' }));
		else ctx.ui.trackList(body, visible.slice().sort(function (x, y) { return (y.plays || 0) - (x.plays || 0) || (y.rating || 0) - (x.rating || 0); }), { context: queue, noHead: true });
		body.appendChild(h('a', { class: 'ts-artist-launch-link', href: href(a.name, L, 'catalog', { catalog: 'albums' }), text: 'Browse albums and EPs' }));
		if (hooks.works && a.tracks.length) hooks.works(body, Object.assign({}, a, { tracks: visible }));
		if (hooks.voice && a.tracks.length) hooks.voice(body, a);
	}
	return { subject: subject, href: href, view: view };
});
