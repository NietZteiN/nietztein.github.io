// Local artist shortcuts. Opening a link, rather than rendering the player, asks for a catalog.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.TrueShuffle.artistLaunch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	function targets(t, L, lib) {
		if (!t) return [];
		var out = [], seen = Object.create(null);
		function add(name, role) {
			name = String(name || '').trim(); if (!name) return;
			var key = L.normArtist(name), alias = lib && lib.aliases && lib.aliases[key];
			if (alias) { name = alias; key = L.normArtist(name); }
			if (!key || seen[key]) return; seen[key] = true;
			out.push({ name: name, key: key, role: role || '' });
		}
		if (t.artist) {
			var people = L.people(t.artist).filter(function (p) { return p.as !== 'character'; });
			// An ampersand can be a band's name, not proof of separate performers.
			if (!/\b(?:feat[.]|ft[.]|featuring|C[.]?V[.]?\s*[:.])/i.test(t.artist)) add(t.artist, 'Artist credit');
			people.forEach(function (p) { add(p.name, p.as === 'cv' ? 'Voice performer' : 'Performer'); });
			if (!people.length || (people.length > 1 && !/\bC[.]?V[.]?\s*[:.]/i.test(t.artist))) add(t.artist, 'Full artist credit');
			(t.feat || []).forEach(function (name) { add(name, 'Featured artist'); });
		}
		if (t.origArtist) add(t.origArtist, 'Original artist');
		return out;
	}
	function href(name, catalog, extra) {
		var q = new URLSearchParams(); q.set('artist', name);
		if (catalog && catalog !== 'songs') q.set('catalog', catalog);
		if (extra && extra.missing) q.set('missing', '1');
		return '#/for-you?' + q.toString();
	}
	function render(ctx, t, options) {
		options = options || {};
		var h = ctx.h, list = targets(t, ctx.L, ctx.lib()), first = list[0];
		function destination(name, catalog, extra) { return ctx.artistHref ? ctx.artistHref(name, catalog, extra) : href(name, catalog, extra); }
		if (options.compact) {
			if (!first) return null;
			return h('a', { class: 'ts-artist-shortcut', href: destination(first.name), title: 'More music by ' + first.name, aria: { label: 'More music by ' + first.name } }, ctx.icon('compass'));
		}
		var box = h('section', { class: 'ts-artist-launch', aria: { label: 'Discover from this song' } });
		box.appendChild(h('p', { class: 'ts-artist-launch-kicker', text: options.title || 'More from this artist' }));
		if (!first) {
			box.appendChild(h('p', { class: 'ts-muted', text: 'Choose the artist to find their songs and albums. This song has no confirmed artist yet.' }));
			box.appendChild(h('a', { class: 'ts-artist-launch-link', href: '#/for-you', text: 'Choose an artist' })); return box;
		}
		var name = first.name, heading = h('h3', { text: name }); box.appendChild(heading);
		var links = h('div', { class: 'ts-artist-launch-links' });
		function drawLinks() {
			ctx.clear(links); heading.textContent = name;
			[['Songs', 'songs', false], ['Albums & EPs', 'albums', false], ['Missing songs', 'songs', true], ['Singles', 'singles', false]].forEach(function (choice) {
				links.appendChild(h('a', { class: 'ts-artist-launch-link', href: destination(name, choice[1], { missing: choice[2] }), text: choice[0], aria: { label: choice[0] + ' by ' + name } }));
			});
		}
		if (list.length > 1) {
			var select = h('select', { class: 'kit-select', aria: { label: 'Artist from this song' } });
			list.forEach(function (p) { select.appendChild(h('option', { value: p.name, text: p.name + (p.role ? ' - ' + p.role.toLowerCase() : '') })); });
			select.addEventListener('change', function () { name = select.value; drawLinks(); });
			box.appendChild(h('label', { class: 'ts-artist-launch-choice' }, [h('span', { text: 'Explore a performer' }), select]));
		}
		drawLinks(); box.appendChild(links);
		if (options.songLabel) box.appendChild(h('p', { class: 'ts-artist-launch-song', text: 'From ' + ctx.words.title(t) }));
		return box;
	}
	function live(host, ctx) {
		var signature = '', off = null;
		function update() {
			if (!host.isConnected) { if (off) off(); return; }
			var t = ctx.current(), next = t ? JSON.stringify([t.id, ctx.words.title(t), targets(t, ctx.L, ctx.lib())]) : '';
			if (signature === next || host.contains(document.activeElement)) return;
			signature = next; ctx.clear(host); host.hidden = !t;
			if (t) host.appendChild(render(ctx, t, { title: 'From your current song', songLabel: true }));
		}
		host.hidden = true; update();
		host.addEventListener('focusout', function () { setTimeout(update, 0); });
		if (ctx.bus && ctx.bus.on) off = ctx.bus.on('bar', update);
	}
	return { targets: targets, href: href, render: render, live: live };
});
