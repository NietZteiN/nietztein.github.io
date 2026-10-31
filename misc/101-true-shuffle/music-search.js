// Explicit catalog search. The player and ordinary library typing never call a provider.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(root);
	else root.TrueShuffle.musicSearch = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';
	function text(v) { return v == null ? '' : String(v); }
	function fold(v) { return text(v).normalize('NFKC').toLocaleLowerCase(); }
	function state(query) {
		var q = query || new URLSearchParams(), kind = q.get('kind') || 'all';
		return { query: q.get('q') || '', discover: q.get('scope') === 'discover', kind: ['all', 'artists', 'songs', 'albums'].indexOf(kind) >= 0 ? kind : 'all', run: q.get('run') === '1' };
	}
	function searchHref(s, changes) {
		var q = new URLSearchParams();
		var n = { query: s.query, discover: s.discover, kind: s.kind, run: s.run };
		Object.keys(changes || {}).forEach(function (k) { n[k] = changes[k]; });
		if (n.query) q.set('q', n.query);
		if (n.discover) { q.set('scope', 'discover'); if (n.kind !== 'all') q.set('kind', n.kind); if (n.run) q.set('run', '1'); }
		return '#/search' + (q.toString() ? '?' + q.toString() : '');
	}
	function albumShape(al) {
		var out = Object.assign({}, al); out.source = out.source || 'itunes';
		out.key = out.key || 'it:album:' + out.id; out.ids = out.ids || { itunes: out.id };
		out.year = out.year || parseInt(text(out.date).slice(0, 4), 10) || 0;
		out.type = text(out.type || 'album').toLowerCase();
		return out;
	}
	function songsFrom(raw, Src) {
		return (raw && Array.isArray(raw.results) ? raw.results : []).filter(function (r) { return r.wrapperType === 'track' && r.kind === 'song' && r.trackId != null; }).map(function (r) {
			var cover = text(r.artworkUrl100).replace('/100x100bb.', '/300x300bb.');
			return Src.find({ title: r.trackName, artist: r.artistName, album: r.collectionName, albumId: r.collectionId == null ? '' : 'it:' + r.collectionId, year: parseInt(text(r.releaseDate).slice(0, 4), 10) || 0,
				durationSec: Math.round((+r.trackTimeMillis || 0) / 1000), seq: +r.trackNumber || 0, source: 'itunes', ids: { it: r.trackId }, cover: Src.okImage(cover) ? cover : '', preview: Src.okPreview(r.previewUrl) ? r.previewUrl : '' });
		});
	}
	function demoResults(ctx, query) {
		var TS = root.TrueShuffle, lib = ctx.lib(), names = Object.create(null), out = { artists: [], songs: [], albums: [], errors: [] }, needle = fold(query);
		ctx.L.list(lib).forEach(function (t) { if (t.artist) names[ctx.L.normArtist(t.artist)] = t.artist; });
		var svc = TS.artists.create({ L: ctx.L, M: TS.match, tracks: function () { return ctx.L.list(lib); } });
		Object.keys(names).forEach(function (key) {
			var name = names[key], d = svc.demo(key, lib); if (!d) return;
			if (fold(name).indexOf(needle) >= 0) out.artists.push({ id: key, name: name, genre: 'Invented demo artist' });
			(d.discography.top || []).forEach(function (f) { if (fold(f.title + ' ' + f.artist).indexOf(needle) >= 0) out.songs.push(f); });
			['albums', 'eps', 'singles', 'compilations'].forEach(function (kind) { (d.discography[kind] || []).forEach(function (al) { if (fold(al.title + ' ' + name).indexOf(needle) >= 0) out.albums.push(albumShape(al)); }); });
		});
		out.artists = out.artists.slice(0, 12); out.songs = out.songs.slice(0, 25); out.albums = out.albums.slice(0, 25); return out;
	}
	function request(ctx, query, kind, signal) {
		var TS = root.TrueShuffle, Src = TS.sources;
		if (ctx.demo) return Promise.resolve(demoResults(ctx, query));
		var http = ctx.http(), cache = ctx.cache(), it = Src.iTunes(http, cache), out = { artists: [], songs: [], albums: [], errors: [] }, country = /[\u3040-\u30FF\u3400-\u9FFF]/.test(query) ? 'JP' : 'US';
		function one(key, work) { return Promise.resolve().then(work).then(function (items) { out[key] = items || []; }, function (err) { if (err && err.code === 'aborted') throw err; out.errors.push(key); }); }
		var tasks = [], o = { signal: signal, limit: 25 };
		if (kind === 'all' || kind === 'artists') tasks.push(one('artists', function () { return it.searchArtist(query, o); }));
		if (kind === 'all' || kind === 'albums') tasks.push(one('albums', function () { return it.searchAlbums(query, o).then(function (items) { return items.map(function (al) { return albumShape(Object.assign({}, al, { country: country })); }); }); }));
		if (kind === 'all' || kind === 'songs') tasks.push(one('songs', function () {
			return cache.wrap('music-search:song:' + country + ':' + query.trim().toLocaleLowerCase(), Src.TTL.itSearch, function () {
				return http.get('itunes', '/search', { signal: signal, query: { term: query, media: 'music', entity: 'song', limit: 25, country: country } }).then(function (raw) { return songsFrom(raw, Src); });
			}, o).then(function (items) { return items || []; });
		}));
		return Promise.all(tasks).then(function () { return out; });
	}
	function artistHref(name, L) { return '#/artist/' + encodeURIComponent(L.normArtist(name)) + '?artist=' + encodeURIComponent(name) + '&tab=catalog'; }
	function albumHref(al) {
		if (!al.demo && /^(itunes|deezer)$/.test(al.source) && /^\d+$/.test(text(al.id))) {
			var direct = new URLSearchParams({ artist: al.artist || '', title: al.title || '', country: al.country || 'US' });
			return '#/album/' + al.source + '/' + al.id + '?' + direct.toString();
		}
		var q = new URLSearchParams({ artist: al.artist || '', catalog: al.type === 'single' ? 'singles' : al.type === 'compilation' ? 'compilations' : 'albums', album: al.key, releaseQuery: al.title || '' });
		return '#/for-you?' + q.toString();
	}
	function view(view, ctx, query, options) {
		options = options || {};
		var TS = root.TrueShuffle, h = ctx.h, U = ctx.U, s = state(query);
		var shell = h('section', { class: 'ts-music-search' }), scope = h('nav', { class: 'ts-search-scope ts-chips', aria: { label: 'Search scope' } }); view.appendChild(shell); shell.appendChild(scope);
		[['Your library', false], ['Find new music', true]].forEach(function (choice) { scope.appendChild(h('a', { class: 'ts-chip' + (s.discover === choice[1] ? ' is-on' : ''), href: searchHref(s, { discover: choice[1], run: false }), text: choice[0], aria: { current: s.discover === choice[1] ? 'page' : null } })); });
		if (!s.discover) {
			shell.appendChild(h('p', { class: 'ts-muted ts-search-scope-note', text: 'Searching your imported music. Choose Find new music for artists, songs and albums beyond your library.' }));
			if (options.library) options.library(shell); return;
		}
		var panel = h('div', { class: 'ts-search-discover' }); shell.appendChild(panel);
		panel.appendChild(h('h1', { class: 'ts-h1', text: 'Find new music' }));
		panel.appendChild(h('p', { class: 'ts-muted', text: ctx.demo ? 'Search the invented demo catalog. No music services are contacted.' : 'Search artists, songs and albums in the Apple catalog. Search runs only when you submit. Playing a new song may then need a YouTube search.' }));
		var form = h('form', { class: 'ts-inline-form' }), input = h('input', { class: 'kit-input', type: 'search', value: s.query, placeholder: 'Artist, song or album', aria: { label: 'Search music catalogs' } });
		var submit = U.btn({ label: 'Search catalog', icon: 'search', variant: 'primary', type: 'submit' }); form.appendChild(input); form.appendChild(submit); panel.appendChild(form);
		var kinds = h('nav', { class: 'ts-search-types ts-chips', aria: { label: 'Catalog result type' } }); panel.appendChild(kinds);
		[['all', 'All'], ['artists', 'Artists'], ['songs', 'Songs'], ['albums', 'Albums']].forEach(function (choice) { kinds.appendChild(h('a', { class: 'ts-chip' + (s.kind === choice[0] ? ' is-on' : ''), href: searchHref(s, { kind: choice[0], run: false }), text: choice[1], aria: { current: s.kind === choice[0] ? 'page' : null } })); });
		var result = h('div', { class: 'ts-search-results' }), status = h('p', { class: 'ts-muted', role: 'status' }); panel.appendChild(status); panel.appendChild(result);
		var turn = 0, controller = null;
		function refreshLinks() {
			[].slice.call(scope.children).forEach(function (link, i) { link.href = searchHref(s, { discover: i === 1, run: false }); });
			[].slice.call(kinds.children).forEach(function (link, i) { link.href = searchHref(s, { kind: ['all', 'artists', 'songs', 'albums'][i], run: false }); });
		}
		function art(al) {
			var wrap = h('span', { class: 'ts-search-result-art' });
			if (!ctx.demo && !ctx.thumb && ctx.prefs().art !== false && TS.sources.okImage(al.cover)) wrap.appendChild(h('img', { src: al.cover, alt: '', loading: 'lazy', decoding: 'async' }));
			else wrap.appendChild(U.swatch(160, al.title || al.name, 'ts-search-swatch'));
			return wrap;
		}
		function group(title, list, kind) {
			if (!list.length) return;
			var block = h('section', { class: 'ts-search-result-group', data: { kind: kind } }); result.appendChild(block); block.appendChild(h('h2', { text: title + ' (' + list.length + ')' }));
			if (kind === 'songs') {
				var rows = TS.media.list(ctx, list, { label: 'Catalog songs for ' + s.query, context: { label: 'Search: ' + s.query, href: searchHref(s) }, preview: true }); block.appendChild(rows);
				if (TS.discoveryShelf) [].slice.call(rows.children).forEach(function (row, i) { var b = TS.discoveryShelf.songButton(ctx, list[i], { iconOnly: true }); if (b) row.querySelector('.ts-m-acts').appendChild(b); });
				return;
			}
			var grid = h('div', { class: 'ts-search-result-grid' }); block.appendChild(grid);
			list.forEach(function (item) {
				var card = h('article', { class: 'ts-search-result' }), name = kind === 'artists' ? item.name : item.title, href = kind === 'artists' ? artistHref(name, ctx.L) : albumHref(item);
				var link = h('a', { class: 'ts-search-result-link', href: href }); link.appendChild(art(item));
				link.appendChild(h('span', { class: 'ts-search-result-type', text: kind === 'artists' ? 'Artist' : item.type === 'ep' ? 'EP' : item.type === 'single' ? 'Single' : 'Album' }));
				link.appendChild(h('h3', { text: name })); card.appendChild(link);
				card.appendChild(h('p', { class: 'ts-muted', text: kind === 'artists' ? item.genre || 'Browse songs and albums' : [item.artist, item.year || '', item.trackCount ? item.trackCount + ' songs' : ''].filter(Boolean).join(' / ') }));
				if (kind === 'albums' && TS.discoveryShelf) { var buttons = h('div', { class: 'ts-row-btns' }), args = { kind: 'album', artist: item.artist, href: href }; buttons.appendChild(TS.discoveryShelf.albumButton(ctx, item, args)); buttons.appendChild(TS.discoveryShelf.collectButton(ctx, item, args)); card.appendChild(buttons); }
				grid.appendChild(card);
			});
		}
		function run() {
			var term = input.value.trim();
			if (!term) { status.textContent = 'Enter an artist, song or album to search.'; input.focus(); return; }
			s.query = term; s.run = true; refreshLinks(); if (ctx.replaceRoute) ctx.replaceRoute(searchHref(s));
			if (controller) controller.abort(); controller = new AbortController(); var signal = controller.signal, mine = ++turn;
			ctx.clear(result); status.textContent = 'Searching the catalog for ' + term + '...'; U.btnState(submit, { busy: true });
			request(ctx, term, s.kind, signal).then(function (data) {
				if (mine !== turn || !shell.isConnected) return;
				var count = 0; ['artists', 'songs', 'albums'].forEach(function (key) { if (s.kind === 'all' || s.kind === key) count += data[key].length; });
				status.textContent = count ? count + ' catalog results for ' + term + '.' : 'No catalog matches for ' + term + '. Try another spelling or search type.';
				if (data.errors.length) status.textContent = data.errors.length === (s.kind === 'all' ? 3 : 1) ? 'The catalog search could not load. Try again, or search your library.' : status.textContent + ' Some result types could not load; the available results are shown.';
				if (s.kind === 'all' || s.kind === 'artists') group('Artists', data.artists, 'artists');
				if (s.kind === 'all' || s.kind === 'songs') group('Songs', data.songs, 'songs');
				if (s.kind === 'all' || s.kind === 'albums') group('Albums & releases', data.albums, 'albums');
			}, function (err) { if (mine === turn && shell.isConnected && !(err && err.code === 'aborted')) status.textContent = 'The catalog search could not load. Try again.'; }).then(function () { if (mine === turn && shell.isConnected) U.btnState(submit, { busy: false }); });
		}
		input.addEventListener('input', function () { if (controller) controller.abort(); turn++; U.btnState(submit, { busy: false }); s.run = false; s.query = input.value; refreshLinks(); if (ctx.replaceRoute) ctx.replaceRoute(searchHref(s)); ctx.clear(result); status.textContent = 'Press Search catalog to find new music.'; });
		form.addEventListener('submit', function (event) { event.preventDefault(); run(); });
		status.textContent = 'Choose a result type, then press Search catalog.';
		if (s.run && s.query.trim()) run();
	}
	return { state: state, searchHref: searchHref, albumShape: albumShape, songsFrom: songsFrom, request: request, view: view };
});
