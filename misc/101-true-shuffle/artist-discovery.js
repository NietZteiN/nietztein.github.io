// Discover starts with the people the listener chooses, across their whole library.
(function (TS) {
	'use strict';
	var demoFollowed = [];
	TS.artistDiscovery = function (view, ctx, query) {
		var h = ctx.h, U = ctx.U, L = ctx.L, Me = TS.media, Src = TS.sources;
		var box = h('section', { class: 'ts-artist-discovery', id: 'fy-artists' });
		view.appendChild(box);
		box.appendChild(h('h2', { text: 'Who do you want to hear?' }));
		box.appendChild(h('p', { class: 'ts-muted', text: 'Pick someone you listen to, or type any artist. Browse their songs and albums, then find the song you want on YouTube.' }));
		var all = {}, follows = ctx.demo ? demoFollowed.slice() : ToyKit.load('discoveryArtists', []);
		if (!Array.isArray(follows)) follows = [];
		L.list(ctx.lib()).forEach(function (t) {
			if (!t.artist) return;
			var names = [t.artist].concat(L.people(t.artist).filter(function (p) { return p.as !== 'character'; }).map(function (p) { return p.name; }));
			names.forEach(function (name) { var k = L.normArtist(name); if (!k) return; var a = all[k] || (all[k] = { name: name, score: 0 }); a.score += (t.plays || 0) + (t.rating || 0) * 2 + 1; });
		});
		var form = h('form', { class: 'ts-inline-form' }), input = h('input', { class: 'kit-input', type: 'search', list: 'discover-artist-names', placeholder: 'Artist or performer', aria: { label: 'Artist to discover' } });
		form.appendChild(input); form.appendChild(U.btn({ label: 'Find their music', icon: 'search', type: 'submit', variant: 'primary' }));
		var names = h('datalist', { id: 'discover-artist-names' });
		Object.keys(all).sort().forEach(function (k) { names.appendChild(h('option', { value: all[k].name })); });
		form.appendChild(names); box.appendChild(form);
		var picks = h('div', { class: 'ts-discovery-picks' }), chosen = '', version = 0, controller = null;
		box.appendChild(picks);
		var result = h('div', { class: 'ts-discovery-result' }); box.appendChild(result);
		function drawPicks() {
			ctx.clear(picks);
			function group(title, ns) {
				if (!ns.length) return;
				picks.appendChild(h('h3', { text: title })); var row = h('div', { class: 'ts-chips' });
				ns.forEach(function (name) { row.appendChild(U.btn({ label: name, variant: 'chip', on: { click: function () { choose(name); } } })); }); picks.appendChild(row);
			}
			group('Artists you chose', follows);
			group('From your listening', Object.keys(all).sort(function (a, b) { return all[b].score - all[a].score; }).map(function (k) { return all[k].name; }).filter(function (name) { return !follows.some(function (f) { return L.normArtist(f) === L.normArtist(name); }); }).slice(0, 8));
		}
		var http = ctx.http(), cache = ctx.cache(), M = TS.match;
		var artists = TS.artists.create({ it: http ? Src.iTunes(http, cache) : null, dz: http ? Src.deezerFinds(ctx.deezer(), cache) : null, M: M, L: L, tracks: function () { return L.list(ctx.lib()); }, index: ctx.libIndex, map: ctx.findsMap, now: ctx.now });
		function choose(name) {
			name = String(name || '').trim(); if (!name) { input.focus(); return; }
			chosen = name; input.value = name; var turn = ++version;
			if (controller) controller.abort(); controller = new AbortController(); var signal = controller.signal;
			ctx.clear(result); result.appendChild(h('h3', { text: 'Music by ' + name }));
			var follow = U.btn({ label: '', variant: 'secondary', on: { click: function () {
				var key = L.normArtist(name), has = follows.some(function (f) { return L.normArtist(f) === key; });
				follows = follows.filter(function (f) { return L.normArtist(f) !== key; }); if (!has) follows.push(name);
				if (ctx.demo) demoFollowed = follows.slice(); else ToyKit.store('discoveryArtists', follows);
				setFollow(); drawPicks(); if (ctx.discoveryChanged) ctx.discoveryChanged();
			} } });
			function setFollow() { U.btnState(follow, { label: follows.some(function (f) { return L.normArtist(f) === L.normArtist(name); }) ? 'Remove from chosen artists' : 'Keep this artist here' }); }
			setFollow(); result.appendChild(follow);
			var search = h('form', { class: 'ts-inline-form' }), title = h('input', { class: 'kit-input', type: 'search', placeholder: 'Song title (optional)', aria: { label: 'Song to find on YouTube' } });
			search.appendChild(title); var go = U.btn({ label: 'Search YouTube', icon: ctx.canRead() ? 'search' : 'external', type: 'submit', variant: 'secondary', cost: ctx.canRead() ? 100 : null, title: ctx.canRead() ? 'Search here: 100 YouTube units' : 'Open YouTube search in a new tab' }); search.appendChild(go); result.appendChild(search);
			var videos = h('div'), catalog = h('div', { aria: { live: 'polite' } }); result.appendChild(videos); result.appendChild(catalog);
			function current() { return turn === version && box.isConnected; }
			search.addEventListener('submit', function (e) {
				e.preventDefault(); var words = name + ' ' + (title.value.trim() || 'official music');
				if (ctx.demo) { ctx.say('The demo cannot search YouTube.'); return; }
				if (!ctx.canRead() || !ctx.client()) { window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(words), '_blank', 'noopener'); return; }
				U.btnState(go, { busy: true }); ctx.clear(videos); videos.appendChild(h('p', { text: 'Searching YouTube...' }));
				ctx.client().search(words, { max: 20, signal: signal }).then(function (items) {
					if (!current()) return; ctx.clear(videos); videos.appendChild(h('h4', { text: 'YouTube results for ' + words }));
					var finds = items.filter(function (v) { return U.YT_ID.test(v.videoId); }).map(function (v) { var p = TS.parse.parse(v.title, v.channel); return Src.find({ title: p.title || v.title, artist: p.artist || v.channel, videoId: v.videoId, channel: v.channel, channelId: v.channelId, source: 'ytsearch' }); });
					if (!finds.length) videos.appendChild(h('p', { text: 'No videos found. Try a song title or another spelling.' })); else videos.appendChild(Me.list(ctx, finds, { label: 'YouTube songs by ' + name, context: { label: name, href: '#/for-you' } }));
				}, function (err) { if (current()) { ctx.clear(videos); videos.appendChild(h('p', { text: 'YouTube search failed: ' + err.message })); } }).then(function () { if (current()) U.btnState(go, { busy: false }); });
			});
			catalog.appendChild(h('p', { text: 'Finding their songs and albums...' }));
			var who = { key: L.normArtist(name), name: name, native: (ctx.lib().profiles[L.normArtist(name)] || {}).native || '' };
			var d = ctx.demo ? artists.demo(who.key, ctx.lib()) : null;
			var get = ctx.demo ? Promise.resolve(d ? { found: d.found, dg: d.discography } : null) : artists.find(who, { signal: signal }).then(function (fa) { return fa ? artists.discography(fa, { signal: signal }).then(function (dg) { return { found: fa, dg: dg }; }) : null; });
			get.then(function (data) {
				if (!current()) return; ctx.clear(catalog);
				if (!data) { catalog.appendChild(h('p', { text: ctx.demo ? 'Pick an artist from the demo library to browse invented songs.' : 'No catalog found for this spelling. You can still search YouTube above.' })); return; }
				if (data.found.sure === false) catalog.appendChild(h('p', { class: 'ts-muted', text: 'Possible catalog match: ' + [data.found.itunes, data.found.deezer].filter(Boolean).map(function (a) { return a.name; }).join(' / ') + '. Check the names before playing or adding.' }));
				var dg = data.dg, pane = 0, tabs = h('div', { class: 'ts-chips', role: 'tablist', aria: { label: 'Browse music by ' + name } }), body = h('div'); catalog.appendChild(tabs); catalog.appendChild(body);
				function songs(list, label) {
					pane++; ctx.clear(body); body.appendChild(h('h4', { text: label })); var missing = false, toggle = U.btn({ label: 'Only songs I do not have', variant: 'chip', pressed: false, on: { click: function () { missing = !missing; U.btnState(toggle, { pressed: missing }); draw(); } } });
					body.appendChild(toggle); var rows = h('div'); body.appendChild(rows);
					function draw() { ctx.clear(rows); var shown = list.filter(function (f) { return !missing || !(f.mine || M.inLibrary(ctx.libIndex(), f)); }); if (!shown.length) rows.appendChild(h('p', { text: 'No songs to show with this filter.' })); else rows.appendChild(Me.list(ctx, shown, { label: label, context: { label: name, href: '#/for-you' } })); }
					draw();
				}
				function albums(list) {
					pane++; ctx.clear(body); list.forEach(function (al) { body.appendChild(U.btn({ label: al.title + (al.year ? ' (' + al.year + ')' : ''), variant: 'secondary', on: { click: function () {
						var run = ++pane;
						ctx.clear(body); body.appendChild(h('p', { text: 'Loading ' + al.title + '...' }));
						artists.albumTracks(al, { signal: signal }).then(function (r) { if (current() && pane === run) songs(r.tracks || [], al.title); }, function (err) { if (current() && pane === run) { ctx.clear(body); body.appendChild(h('p', { text: 'Album could not load: ' + err.message })); } });
					} } })); }); if (!list.length) body.appendChild(h('p', { text: 'No releases found.' }));
				}
				[['Songs', function () { songs(dg.top || [], name); }], ['Albums & EPs', function () { albums((dg.albums || []).concat(dg.eps || [])); }], ['Singles', function () { albums(dg.singles || []); }]].forEach(function (t, i) { var b = U.btn({ label: t[0], variant: 'chip', pressed: i === 0, aria: { selected: i === 0 ? 'true' : 'false' }, on: { click: function () { [].slice.call(tabs.children).forEach(function (x) { U.btnState(x, { pressed: x === b }); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); }); t[1](); } } }); b.setAttribute('role', 'tab'); tabs.appendChild(b); }); songs(dg.top || [], name);
			}, function (err) { if (current()) { ctx.clear(catalog); catalog.appendChild(h('p', { text: 'Catalog could not load: ' + err.message + '. Try YouTube above.' })); } });
		}
		form.addEventListener('submit', function (e) { e.preventDefault(); choose(input.value); }); drawPicks();
		var initial = query && query.get('artist'); if (initial) choose(initial);
	};
	TS.artistDiscovery.chosen = function (ctx) { var names = ctx.demo ? demoFollowed.slice() : ToyKit.load('discoveryArtists', []); return Array.isArray(names) ? names.slice() : []; };
})(window.TrueShuffle);
