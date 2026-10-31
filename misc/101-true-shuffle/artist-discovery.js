// Discover starts with the people the listener chooses, across their whole library.
(function (TS) {
	'use strict';
	var demoFollowed = [];
	TS.artistDiscovery = function (view, ctx, query, options) {
		options = options || {};
		if (ctx.demo) demoFollowed = ToyKit.load('discoveryArtistsDemo', []);
		var h = ctx.h, U = ctx.U, L = ctx.L, Me = TS.media, Src = TS.sources;
		var params = new URLSearchParams(query && query.toString ? query.toString() : '');
		if (options.artist) params.set('artist', options.artist);
		var layoutKey = ctx.demo ? 'releaseLayoutDemo' : 'releaseLayout';
		var state = { artist: params.get('artist') || '', catalog: params.get('catalog') || 'songs', album: params.get('album') || '', missing: params.get('missing') === '1', songQuery: params.get('songQuery') || '', releaseQuery: params.get('releaseQuery') || '', order: params.get('order') || 'newest', hideComplete: params.get('hideComplete') === '1' };
		state.density = (params.get('density') || ToyKit.load(layoutKey, 'spacious')) === 'compact' ? 'compact' : 'spacious';
		if (options.directAlbum) { state.catalog = options.directAlbum.type === 'single' ? 'singles' : options.directAlbum.type === 'compilation' ? 'compilations' : 'albums'; state.album = String(options.directAlbum.key || options.directAlbum.source + ':' + options.directAlbum.id); }
		if (['songs', 'albums', 'singles', 'compilations'].indexOf(state.catalog) < 0) state.catalog = 'songs';
		if (['newest', 'oldest', 'title'].indexOf(state.order) < 0) state.order = 'newest';
		function currentHref() {
			params.set('artist', state.artist);
			[['catalog', state.catalog === 'songs' ? '' : state.catalog], ['album', state.album], ['missing', state.missing ? '1' : ''], ['songQuery', state.songQuery], ['releaseQuery', state.releaseQuery], ['order', state.order === 'newest' ? '' : state.order], ['hideComplete', state.hideComplete ? '1' : ''], ['density', state.density === 'compact' ? 'compact' : '']].forEach(function (p) { if (p[1]) params.set(p[0], p[1]); else params.delete(p[0]); });
			return (options.base || '#/for-you') + '?' + params.toString();
		}
		function remember() { if (ctx.replaceRoute) ctx.replaceRoute(currentHref()); }
		var box = h('section', { class: 'ts-artist-discovery', id: 'fy-artists' });
		view.appendChild(box);
		if (!options.embedded) {
			box.appendChild(h('h2', { text: 'Who do you want to hear?' }));
			box.appendChild(h('p', { class: 'ts-muted', text: 'Pick someone you listen to, or type any artist. Browse their songs and albums, then find the song you want on YouTube.' }));
		}
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
		form.appendChild(names); if (!options.embedded) box.appendChild(form);
		var picks = h('div', { class: 'ts-discovery-picks' }), chosen = '', version = 0, controller = null;
		if (!options.embedded) box.appendChild(picks);
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
		function choose(name, restore) {
			name = String(name || '').trim(); if (!name) { input.focus(); return; }
			if (!restore) { state = { artist: name, catalog: 'songs', album: '', missing: false, songQuery: '', releaseQuery: '', order: 'newest', hideComplete: false, density: state.density }; remember(); }
			chosen = name; input.value = name; var turn = ++version;
			if (controller) controller.abort(); controller = new AbortController(); var signal = controller.signal;
			ctx.clear(result); if (!options.embedded) result.appendChild(h('h3', { text: 'Music by ' + name }));
			if (!options.embedded) result.appendChild(h('a', { class: 'ts-artist-page-link', href: '#/artist/' + encodeURIComponent(L.normArtist(name)) + '?artist=' + encodeURIComponent(name) + '&tab=catalog', text: 'Open artist page' }));
			var follow = U.btn({ label: '', variant: 'secondary', on: { click: function () {
				var key = L.normArtist(name), has = follows.some(function (f) { return L.normArtist(f) === key; });
				follows = follows.filter(function (f) { return L.normArtist(f) !== key; }); if (!has) follows.push(name);
				if (ctx.demo) { demoFollowed = follows.slice(); ToyKit.store('discoveryArtistsDemo', demoFollowed); } else ToyKit.store('discoveryArtists', follows);
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
					if (!finds.length) videos.appendChild(h('p', { text: 'No videos found. Try a song title or another spelling.' })); else videos.appendChild(Me.list(ctx, finds, { label: 'YouTube songs by ' + name, context: { label: name, href: currentHref() } }));
				}, function (err) { if (current()) { ctx.clear(videos); videos.appendChild(h('p', { text: 'YouTube search failed: ' + err.message })); } }).then(function () { if (current()) U.btnState(go, { busy: false }); });
			});
			catalog.appendChild(h('p', { text: 'Finding their songs and albums...' }));
			var who = { key: L.normArtist(name), name: name, native: (ctx.lib().profiles[L.normArtist(name)] || {}).native || '' };
			var d = ctx.demo ? artists.demo(who.key, ctx.lib()) : null;
			var direct = options.directAlbum, directCatalog = { top: [], albums: [], eps: [], singles: [], compilations: [] };
			if (direct) directCatalog[state.catalog === 'singles' ? 'singles' : state.catalog === 'compilations' ? 'compilations' : 'albums'].push(direct);
			var get = direct ? Promise.resolve({ found: { sure: true }, dg: directCatalog }) : ctx.demo ? Promise.resolve(d ? { found: d.found, dg: d.discography } : null) : artists.find(who, { signal: signal }).then(function (fa) { return fa ? artists.discography(fa, { signal: signal }).then(function (dg) { return { found: fa, dg: dg }; }) : null; });
			get.then(function (data) {
				if (!current()) return; ctx.clear(catalog);
				if (!data) { catalog.appendChild(h('p', { text: ctx.demo ? 'Pick an artist from the demo library to browse invented songs.' : 'No catalog found for this spelling. You can still search YouTube above.' })); return; }
				if (data.found.sure === false) catalog.appendChild(h('p', { class: 'ts-muted', text: 'Possible catalog match: ' + [data.found.itunes, data.found.deezer].filter(Boolean).map(function (a) { return a.name; }).join(' / ') + '. Check the names before playing or adding.' }));
				if (data.dg.errors && data.dg.errors.length) catalog.appendChild(h('p', { class: 'ts-muted', text: 'Some catalog sources could not load. These are the songs and releases found by the sources that answered.' }));
				var dg = data.dg, pane = 0, listScroll = {}, returnAlbum = '', tabs = h('div', { class: 'ts-chips', role: 'group', aria: { label: 'Browse music by ' + name } }), body = h('div'); catalog.appendChild(tabs); catalog.appendChild(body);
				if (options.directAlbum) tabs.hidden = true;
				if (TS.discoveryShelf && TS.discoveryShelf.recordCatalog) TS.discoveryShelf.recordCatalog(ctx, name, (dg.albums || []).concat(dg.eps || [], dg.singles || [], dg.compilations || []));
				var choices = [['songs', 'Songs'], ['albums', 'Albums & EPs'], ['singles', 'Singles'], ['compilations', 'Compilations']];
				var totals = h('p', { class: 'ts-muted ts-artist-count', hidden: !!options.directAlbum, text: count((dg.top || []).length, 'song') + ' / ' + count((dg.albums || []).length, 'album') + ' / ' + count((dg.eps || []).length, 'EP') + ' / ' + count((dg.singles || []).length, 'single') + ' / ' + count((dg.compilations || []).length, 'compilation') }); catalog.insertBefore(totals, tabs);
				function count(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
				function releaseList(kind) { return kind === 'singles' ? dg.singles || [] : kind === 'compilations' ? dg.compilations || [] : (dg.albums || []).concat(dg.eps || []); }
				function albumKey(al) { return String(al.key || al.source + ':' + al.id); }
				function albumHref(al) { var q = new URLSearchParams(currentHref().split('?')[1]); q.set('album', albumKey(al)); return (options.base || '#/for-you') + '?' + q.toString(); }
				function releaseArt(al, cls) {
					var hue = 0; String(al.title || '').split('').forEach(function (s) { hue = (hue * 31 + s.charCodeAt(0)) % 360; });
					var art = U.swatch(hue, al.title, cls), prefs = ctx.prefs ? ctx.prefs() : {};
					if (!ctx.demo && !ctx.thumb && prefs.art !== false && /^https:\/\//i.test(al.cover || '')) {
						var img = h('img', { src: al.cover, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
						img.addEventListener('error', function () { img.remove(); }); art.appendChild(img);
					}
					return art;
				}
				function shelfActions(al) {
					var row = h('div', { class: 'ts-album-save-actions' }), shelf = TS.discoveryShelf;
					if (shelf) { var o = { artist: name, href: albumHref(al) }; row.appendChild(shelf.albumButton(ctx, al, o)); row.appendChild(shelf.collectButton(ctx, al, { kind: 'album', artist: name, href: o.href })); }
					return row;
				}
				function backToReleases() {
					var kind = state.catalog, key = returnAlbum; showPane(kind, false); var returnedPane = pane;
					requestAnimationFrame(function () {
						if (!current() || pane !== returnedPane) return; var main = document.getElementById('main');
						if (main && typeof listScroll[kind] === 'number') main.scrollTop = listScroll[kind];
						var target = [].slice.call(body.querySelectorAll('[data-release]')).filter(function (b) { return b.getAttribute('data-release') === key; })[0];
						if (target) target.focus({ preventScroll: true });
					});
				}
				function albumActions(al, list) {
					var row = h('div', { class: 'ts-album-actions' }), note = h('p', { class: 'ts-muted ts-album-play-note', role: 'status' }), busy = false, buttons = [];
					var items = list.map(function (f) { var hit = f.mine && ctx.lib().tracks[f.mine] ? { id: f.mine } : M.inLibrary(ctx.libIndex(), f); return hit && ctx.lib().tracks[hit.id] || f; });
					if (ctx.demo) items = items.filter(function (f) { return !!(f.id && ctx.lib().tracks[f.id]); });
					var needsFind = items.some(function (f) { return !f.id && !f.videoId; }), blocked = needsFind && !(ctx.canRead && ctx.canRead());
					note.textContent = ctx.demo ? 'Demo album actions play the ' + count(items.length, 'available song') + ' already in the invented library.' : blocked ? 'Playing the missing songs needs a YouTube API key or sign-in in Settings. You can still save this album.' : needsFind ? 'Missing songs are found on YouTube only when you press an album action. Each lookup can cost up to 100 YouTube units; your quota limit still applies.' : 'Album actions use the available videos. Browsing keeps the current song and queue unchanged.';
					function run(mode) {
						if (busy || blocked || !items.length) return; busy = true;
						buttons.forEach(function (b) { U.btnState(b, { busy: true }); });
						var context = { label: al.title + ' (' + name + ')', href: currentHref() }, work;
						if (mode === 'from') work = Me.playFrom(ctx, items, 0, context);
						else if (items.every(function (f) { return !!(f.id && ctx.lib().tracks[f.id]); })) {
							ctx.play[mode === 'next' ? 'next' : 'later'](items.map(function (f) { return f.id; })); work = Promise.resolve({ count: items.length });
						} else {
							var order = mode === 'next' ? items.slice().reverse() : items.slice(), added = 0;
							work = order.reduce(function (p, f) { return p.then(function () { return Me.play(ctx, f, mode, { context: context }).then(function (r) { if (r && r.videoId) added++; }); }); }, Promise.resolve()).then(function () { return { count: added }; });
						}
						Promise.resolve(work).then(function (r) { note.textContent = mode === 'from' ? 'Album playback started.' : count(r && r.count || 0, 'song') + (mode === 'next' ? ' placed next, in album order.' : ' added to the queue, in album order.'); }, function (e) { note.textContent = 'Album action stopped: ' + (e && e.message || 'The songs could not be found.'); }).then(function () { busy = false; buttons.forEach(function (b) { U.btnState(b, { busy: false }); }); });
					}
					[['Play album', 'play', 'from'], ['Play next', 'playnext', 'next'], ['Add to queue', 'queue', 'later']].forEach(function (a) {
						var b = U.btn({ label: a[0], icon: a[1], variant: a[2] === 'from' ? 'primary' : 'secondary', disabled: blocked || !items.length, on: { click: function () { run(a[2]); } } }); buttons.push(b); row.appendChild(b);
					});
					return h('div', { class: 'ts-album-play' }, [row, note]);
				}
				function hasSong(f) { return !!(f.mine && ctx.lib().tracks[f.mine] || M.inLibrary(ctx.libIndex(), f)); }
				function matches(value, needle) { return !needle || String(value || '').normalize('NFKC').toLocaleLowerCase().indexOf(needle.normalize('NFKC').toLocaleLowerCase()) >= 0; }
				function releaseStats(al) {
					if (Array.isArray(al.tracks)) { var have = al.tracks.filter(hasSong).length; return { have: have, total: al.tracks.length, checked: true }; }
					return { have: typeof al.have === 'number' ? al.have : null, total: +al.trackCount || 0, checked: al.haveFrom === 'tracks' };
				}
				function releaseNote(al) {
					var s = releaseStats(al), parts = [al.type === 'ep' ? 'EP' : al.type || 'release', al.date || al.year || 'Date unknown'];
					if (s.checked) parts.push(s.have + ' of ' + count(s.total, 'song') + ' in your library');
					else if (s.have !== null) parts.push('At least ' + count(s.have, 'song') + ' in your library');
					else parts.push(s.total ? count(s.total, 'song') + ' / open to check your library' : 'Open to see songs');
					return parts.join(' / ');
				}
				function songs(list, label, al) {
					pane++; ctx.clear(body);
					if (state.album && !options.directAlbum) body.appendChild(U.btn({ label: state.catalog === 'singles' ? 'Back to singles' : state.catalog === 'compilations' ? 'Back to compilations' : 'Back to albums', variant: 'ghost', on: { click: backToReleases } }));
					if (options.directAlbum) body.appendChild(h('a', { class: 'ts-back', href: '#/artist/' + encodeURIComponent(L.normArtist(name)) + '?artist=' + encodeURIComponent(name) + '&tab=catalog&catalog=albums', text: 'More releases by ' + name }));
					var heading = h(options.directAlbum ? 'h1' : 'h4', { class: 'ts-album-title', text: label, tabindex: '-1' });
					if (options.directAlbum && !ctx.thumb) document.title = label + ' ' + ctx.words.DOT + ' True Shuffle';
					if (al) {
						var hero = h('div', { class: 'ts-album-hero' }), copy = h('div', { class: 'ts-album-heading' }); hero.appendChild(releaseArt(al, 'ts-album-cover')); copy.appendChild(h('p', { class: 'ts-kicker', text: al.type === 'ep' ? 'EP' : al.type || 'Album' })); copy.appendChild(heading); copy.appendChild(h('p', { class: 'ts-muted ts-artist-release-meta', text: name + ' / ' + releaseNote(al) })); copy.appendChild(shelfActions(al)); hero.appendChild(copy); body.appendChild(hero); body.appendChild(albumActions(al, list));
					} else body.appendChild(heading);
					var missing = state.missing, toggle = U.btn({ label: 'Only songs I do not have', variant: 'chip', pressed: missing, on: { click: function () { missing = !missing; state.missing = missing; remember(); U.btnState(toggle, { pressed: missing }); draw(); } } });
					var tools = h('div', { class: 'ts-artist-catalog-tools' }), filter = h('input', { class: 'kit-input', type: 'search', value: state.songQuery, placeholder: 'Find a song in this list', aria: { label: 'Search these songs' } }); tools.appendChild(filter); tools.appendChild(toggle); body.appendChild(tools);
					var summary = h('p', { class: 'ts-muted ts-artist-song-summary', role: 'status' }); body.appendChild(summary); var rows = h('div'); body.appendChild(rows);
					filter.addEventListener('input', function () { state.songQuery = filter.value; remember(); draw(); });
					function draw() {
						ctx.clear(rows); var have = list.filter(hasSong).length, shown = list.filter(function (f) { return (!missing || !hasSong(f)) && matches(f.title, state.songQuery.trim()); });
						summary.textContent = 'Showing ' + shown.length + ' of ' + count(list.length, 'song') + ' / ' + have + ' in your library / ' + (list.length - have) + ' to discover';
						if (!shown.length) rows.appendChild(h('p', { text: 'No songs to show with these filters. Change the title or turn off the missing-song filter.' }));
						else {
							var rendered = Me.list(ctx, shown, { label: label, numbered: !!al, context: { label: name, href: currentHref() } });
							if (al) [].slice.call(rendered.querySelectorAll('.ts-m-idx')).forEach(function (n, i) { n.textContent = String(list.indexOf(shown[i]) + 1); });
							rows.appendChild(rendered);
						}
					}
					draw(); return heading;
				}
				function openAlbum(al, restore) {
					var takeFocus = !restore && body.contains(document.activeElement), directFocus = !!options.directAlbum && document.activeElement === document.body, run = ++pane;
					if (!restore) { var main = document.getElementById('main'); listScroll[state.catalog] = main ? main.scrollTop : 0; returnAlbum = albumKey(al); }
					state.album = albumKey(al); if (!restore) remember();
					if (TS.discoveryShelf && TS.discoveryShelf.markChecked) TS.discoveryShelf.markChecked(ctx, al, { artist: name, href: currentHref() });
					ctx.clear(body); body.appendChild(h('p', { text: 'Loading ' + al.title + '...' }));
					artists.albumTracks(al, { signal: signal }).then(function (r) { if (current() && pane === run) { al.tracks = r.tracks || []; al.have = r.have; al.haveFrom = 'tracks'; al.trackCount = al.tracks.length; var focus = (takeFocus || directFocus) && document.activeElement === document.body, heading = songs(al.tracks, al.title, al); if (focus) heading.focus(); } }, function (err) { if (current() && pane === run) { ctx.clear(body); body.appendChild(h('p', { text: 'Album could not load: ' + err.message })); body.appendChild(U.btn({ label: 'Back to releases', variant: 'secondary', on: { click: function () { showPane(state.catalog, false); } } })); } });
				}
				function albums(list) {
					pane++; ctx.clear(body);
					var tools = h('div', { class: 'ts-artist-catalog-tools' }), filter = h('input', { class: 'kit-input', type: 'search', value: state.releaseQuery, placeholder: 'Find an album or release', aria: { label: 'Search releases' } }), order = h('select', { class: 'kit-input', aria: { label: 'Sort releases' } }), density = h('select', { class: 'kit-input', aria: { label: 'Release layout' } });
					[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A-Z']].forEach(function (o) { order.appendChild(h('option', { value: o[0], text: o[1] })); }); order.value = state.order;
					[['spacious', 'Spacious covers'], ['compact', 'Compact list']].forEach(function (o) { density.appendChild(h('option', { value: o[0], text: o[1] })); }); density.value = state.density;
					var toggle = U.btn({ label: 'Hide complete releases', variant: 'chip', pressed: state.hideComplete, on: { click: function () { state.hideComplete = !state.hideComplete; remember(); U.btnState(toggle, { pressed: state.hideComplete }); draw(); } } }); tools.appendChild(filter); tools.appendChild(order); tools.appendChild(density); tools.appendChild(toggle); body.appendChild(tools);
					body.appendChild(h('p', { class: 'ts-muted', text: 'Open a release to check its songs against your whole library. Unchecked releases stay visible when complete releases are hidden.' }));
					var summary = h('p', { class: 'ts-muted ts-artist-count', role: 'status' }), rows = h('div', { class: 'ts-artist-releases' }); body.appendChild(summary); body.appendChild(rows);
					filter.addEventListener('input', function () { state.releaseQuery = filter.value; remember(); draw(); }); order.addEventListener('change', function () { state.order = order.value; remember(); draw(); });
					density.addEventListener('change', function () { state.density = density.value; ToyKit.store(layoutKey, state.density); remember(); draw(); });
					function draw() {
						ctx.clear(rows); rows.classList.toggle('is-compact', state.density === 'compact'); var shown = list.filter(function (al) { var s = releaseStats(al); return matches(al.title, state.releaseQuery.trim()) && !(state.hideComplete && s.checked && s.total > 0 && s.have === s.total); });
						shown.sort(function (a, b) { var titleOrder = String(a.title).localeCompare(String(b.title)); if (state.order === 'title') return titleOrder; var ad = a.date || String(a.year || ''), bd = b.date || String(b.year || ''); if (!ad || !bd) return ad ? -1 : bd ? 1 : titleOrder; return (ad < bd ? -1 : ad > bd ? 1 : 0) * (state.order === 'oldest' ? 1 : -1) || titleOrder; });
						summary.textContent = 'Showing ' + shown.length + ' of ' + count(list.length, 'release');
						shown.forEach(function (al) {
							var row = h('article', { class: 'ts-artist-release' }), cover = h('button', { class: 'ts-artist-release-cover', type: 'button', aria: { label: 'Open ' + al.title }, on: { click: function () { openAlbum(al, false); } } }, releaseArt(al, 'ts-artist-release-art'));
							row.appendChild(cover); var content = h('div', { class: 'ts-artist-release-copy' });
							var title = U.btn({ label: al.title + (al.year ? ' (' + al.year + ')' : ''), variant: 'secondary', on: { click: function () { openAlbum(al, false); } } }); title.setAttribute('data-release', albumKey(al)); content.appendChild(title);
							content.appendChild(h('p', { class: 'ts-muted ts-artist-release-meta', text: releaseNote(al) })); content.appendChild(shelfActions(al)); row.appendChild(content); rows.appendChild(row);
						});
						if (!shown.length) rows.appendChild(h('p', { text: list.length ? 'No releases match these filters. Change the title or show complete releases.' : 'No releases found in this category.' }));
					}
					draw();
				}
				function showPane(kind, restore) {
					var focusLost = !restore && body.contains(document.activeElement);
					state.catalog = kind; if (!restore) { state.album = ''; remember(); }
					[].slice.call(tabs.children).forEach(function (b, i) { U.btnState(b, { pressed: choices[i][0] === kind }); });
					if (kind === 'songs') { state.album = ''; songs(dg.top || [], name); return; }
					var list = releaseList(kind), al = state.album && list.filter(function (a) { return albumKey(a) === state.album; })[0];
					if (al) openAlbum(al, true); else { if (state.album) { state.album = ''; remember(); } albums(list); }
					if (focusLost) [].slice.call(tabs.children).forEach(function (b, i) { if (choices[i][0] === kind) b.focus(); });
				}
				choices.forEach(function (choice) { tabs.appendChild(U.btn({ label: choice[1], variant: 'chip', pressed: false, on: { click: function () { showPane(choice[0], false); } } })); }); showPane(state.catalog, true);
			}, function (err) { if (current()) { ctx.clear(catalog); catalog.appendChild(h('p', { text: 'Catalog could not load: ' + err.message + '. Try YouTube above.' })); } });
		}
		form.addEventListener('submit', function (e) { e.preventDefault(); choose(input.value); }); drawPicks();
		var initial = state.artist; if (initial) choose(initial, true);
	};
	TS.artistDiscovery.chosen = function (ctx) { var names = ctx.demo ? ToyKit.load('discoveryArtistsDemo', []) : ToyKit.load('discoveryArtists', []); return Array.isArray(names) ? names.slice() : []; };
	TS.artistDiscovery.album = function (view, ctx, album, options) {
		options = options || {};
		TS.artistDiscovery(view, ctx, options.query || new URLSearchParams(), { embedded: true, base: options.base || '#/for-you', artist: options.artist || album.artist || 'Unknown artist', directAlbum: album });
	};
})(window.TrueShuffle);
