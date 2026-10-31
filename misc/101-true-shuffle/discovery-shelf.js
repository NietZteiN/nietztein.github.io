// Albums to hear, a deliberate discovery tray, and a checked-release inbox.
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.TrueShuffle.discoveryShelf = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
	'use strict';
	var MAX = 150, INBOX_MAX = 400, DAY = 86400000, session = Object.create(null);
	function text(v, max) { return v == null ? '' : String(v).slice(0, max || 512); }
	function fold(v) { return text(v).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
	function copy(v) { return JSON.parse(JSON.stringify(v)); }
	function stamp(ctx) { return ctx && ctx.now ? +ctx.now() : Date.now(); }
	function safeHref(v) { return /^#\//.test(text(v, 2400)) ? text(v, 2400) : ''; }
	function image(v) { return /^https:\/\//i.test(text(v, 1800)) ? text(v, 1800) : ''; }
	function findData(f) {
		f = f || {};
		var out = {}, ids = Object.create(null);
		['key', 'videoId', 'title', 'artist', 'album', 'source', 'channel', 'channelId', 'mine', 'version', 'work', 'role', 'country'].forEach(function (k) { if (f[k]) out[k] = text(f[k], k === 'key' ? 1024 : 512); });
		if (!out.title) return null;
		out.cover = image(f.cover); out.preview = image(f.preview);
		['durationSec', 'seq', 'disc'].forEach(function (k) { if (+f[k] > 0 && isFinite(+f[k])) out[k] = +f[k]; });
		if (f.ids && typeof f.ids === 'object') ['it', 'dz', 'itunes', 'deezer', 'yt'].forEach(function (k) { if (f.ids[k] != null) ids[k] = text(f.ids[k]); }); out.ids = ids;
		return out;
	}
	function hrefFor(al, artist) {
		var q = new URLSearchParams(); q.set('artist', artist);
		q.set('catalog', al.type === 'single' ? 'singles' : al.type === 'compilation' ? 'compilations' : 'albums');
		q.set('album', text(al.key || al.source + ':' + al.id)); return '#/for-you?' + q.toString();
	}
	function pack(item, options) {
		options = options || {}; item = item || {};
		var kind = options.kind === 'album' ? 'album' : 'song', f = item.find || item;
		if (kind === 'song' && item.track && !item.find) f = { key: item.key, videoId: item.track.id, title: item.track.title, artist: item.track.artist, source: 'library', mine: item.track.id };
		var artist = text(options.artist || item.artistName || f.artist), title = text(f.title || item.title);
		if (!title) return null;
		var rawKey = text(f.key || (f.source && f.id != null ? f.source + ':' + f.id : fold(title) + ':' + (f.year || '')), 1024);
		var key = kind + ':' + fold(artist) + ':' + rawKey;
		var out = { key: key, kind: kind, title: title, artist: artist, cover: image(f.cover), at: +options.at || Date.now(), href: safeHref(options.href || item.href) };
		if (kind === 'album') {
			var al = { key: rawKey, title: title, artist: artist, cover: out.cover, source: text(f.source), id: text(f.id), type: text(f.type) || 'album', year: +f.year || 0, date: text(f.date), country: text(f.country), trackCount: Math.max(0, +f.trackCount || 0), ids: {} };
			if (f.ids && typeof f.ids === 'object') ['itunes', 'deezer'].forEach(function (k) { if (f.ids[k] != null) al.ids[k] = text(f.ids[k]); });
			if (Array.isArray(f.tracks)) al.tracks = f.tracks.slice(0, 300).map(findData).filter(Boolean);
			out.release = al; if (!out.href) out.href = hrefFor(al, artist);
		} else { out.find = findData(f); if (!out.find) return null; if (!out.find.artist) out.find.artist = artist; }
		return out;
	}
	function empty() { return { v: 1, albums: [], tray: [], inbox: [], checked: {}, checks: {} }; }
	function normalize(raw) {
		var out = empty(); if (!raw || raw.v !== 1) return out;
		['albums', 'tray', 'inbox'].forEach(function (bucket) {
			var seen = Object.create(null);
			(Array.isArray(raw[bucket]) ? raw[bucket] : []).slice(0, bucket === 'inbox' ? INBOX_MAX : MAX).forEach(function (r) {
				if (!r || (r.kind !== 'album' && r.kind !== 'song') || (bucket !== 'tray' && r.kind !== 'album')) return;
				var e = pack(r.kind === 'album' ? r.release : r.find, { kind: r.kind, artist: r.artist, href: r.href, at: r.at });
				if (e && !seen[e.key]) { seen[e.key] = true; out[bucket].push(e); }
			});
		});
		['checked', 'checks'].forEach(function (field) { if (!raw[field] || typeof raw[field] !== 'object') return; Object.keys(raw[field]).slice(-1200).forEach(function (k) { if (k !== '__proto__' && k !== 'constructor' && +raw[field][k] > 0) Object.defineProperty(out[field], k, { value: +raw[field][k], enumerable: true, writable: true, configurable: true }); }); });
		return out;
	}
	function setEntry(state, bucket, entry, present) {
		var out = normalize(state); if (['albums', 'tray'].indexOf(bucket) < 0 || !entry || (bucket === 'albums' && entry.kind !== 'album')) return out;
		out[bucket] = out[bucket].filter(function (e) { return e.key !== entry.key; });
		if (present) out[bucket].unshift(copy(entry)); out[bucket] = out[bucket].slice(0, MAX); return out;
	}
	function observe(state, artist, releases, now) {
		var out = normalize(state), map = Object.create(null); out.inbox.forEach(function (e) { map[e.key] = e; });
		(releases || []).forEach(function (al) {
			var date = Date.parse(al.date || (al.year ? al.year + '-01-01' : ''));
			if (al.guest || !isFinite(date) || date < now - 120 * DAY) return;
			var entry = pack(al, { kind: 'album', artist: artist, at: now }); if (!entry) return;
			if (map[entry.key]) entry.at = map[entry.key].at; map[entry.key] = entry;
		});
		out.inbox = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return Date.parse(b.release.date || b.release.year + '-01-01') - Date.parse(a.release.date || a.release.year + '-01-01'); }).slice(0, INBOX_MAX);
		out.checks[fold(artist)] = now; return out;
	}
	function counts(state) { var s = normalize(state); return { albums: s.albums.length, tray: s.tray.length, releases: s.inbox.length, unseen: s.inbox.filter(function (e) { return !s.checked[e.key]; }).length }; }
	function chosenNames(ctx) { var TS = root.TrueShuffle; return TS && TS.artistDiscovery && TS.artistDiscovery.chosen ? TS.artistDiscovery.chosen(ctx) : []; }
	function summary(ctx) { var s = read(ctx), names = chosenNames(ctx).map(fold), totals = counts(s); totals.unseen = s.inbox.filter(function (e) { return names.indexOf(fold(e.artist)) >= 0 && !s.checked[e.key]; }).length; return totals; }
	function storageKey(ctx) { return ctx && ctx.demo ? 'discoveryShelfDemoV1' : 'discoveryShelfV1'; }
	function read(ctx) {
		var key = storageKey(ctx), mem = session[key];
		if (mem && mem.temporary) return copy(mem.value);
		var K = root.ToyKit, raw = K && K.load ? K.load(key, null) : null;
		return normalize(raw || (mem && mem.value));
	}
	function write(ctx, value) {
		var key = storageKey(ctx), K = root.ToyKit, normalized = normalize(value), kept = !!(K && K.store && K.store(key, normalized));
		session[key] = { value: normalized, temporary: !kept };
		if (!kept && ctx && ctx.say) ctx.say('Storage is unavailable. Your listening shelf is kept for this tab only.');
		if (ctx && ctx.bus) ctx.bus.emit('discovery-shelf', counts(normalized)); return kept;
	}
	function change(ctx, fn) { var s = read(ctx); write(ctx, fn(s) || s); return read(ctx); }
	function recordCatalog(ctx, name, albums) { return change(ctx, function (s) { return observe(s, name, albums, stamp(ctx)); }); }
	function markChecked(ctx, album, options) { var e = pack(album, Object.assign({ kind: 'album', at: stamp(ctx) }, options)); if (e) change(ctx, function (s) { s.checked[e.key] = stamp(ctx); return s; }); }
	function watchButton(ctx, b, draw) {
		draw(); if (!ctx.bus || !ctx.bus.on) return;
		var off = ctx.bus.on('discovery-shelf', function () { if (!b.isConnected) off(); else draw(); });
	}
	function toggleButton(ctx, item, options, bucket) {
		options = options || {}; var entry = pack(item, Object.assign({}, options, { at: stamp(ctx) }));
		if (!entry) return null;
		var b = ctx.U.btn({ label: '', icon: bucket === 'albums' ? 'bookmark' : 'plus', iconOnly: !!options.iconOnly, variant: 'secondary', size: 'sm', on: { click: function () {
			var had = read(ctx)[bucket].some(function (e) { return e.key === entry.key; });
			if (!had && read(ctx)[bucket].length >= MAX) { if (ctx.say) ctx.say('This shelf holds ' + MAX + ' entries. Remove one before adding another.'); return; }
			change(ctx, function (s) { return setEntry(s, bucket, entry, !had); });
			if (ctx.say) ctx.say(had ? 'Removed from ' + (bucket === 'albums' ? 'Want to hear.' : 'your discovery tray.') : bucket === 'albums' ? 'Album saved to Want to hear.' : 'Collected in your discovery tray.');
		} } });
		b.classList.add('ts-shelf-collect');
		watchButton(ctx, b, function () { var has = read(ctx)[bucket].some(function (e) { return e.key === entry.key; }); ctx.U.btnState(b, { label: bucket === 'albums' ? has ? 'Saved album' : 'Want to hear' : has ? 'Collected' : 'Collect', pressed: has }); b.title = (has ? 'Remove ' : 'Save ') + entry.title + (bucket === 'albums' ? ' in Want to hear' : ' in the discovery tray'); if (options.iconOnly) b.setAttribute('aria-label', (has ? 'Remove ' : 'Collect ') + entry.title + ' in the discovery tray'); });
		return b;
	}
	function albumButton(ctx, al, options) { return toggleButton(ctx, al, Object.assign({}, options, { kind: 'album' }), 'albums'); }
	function collectButton(ctx, item, options) { return toggleButton(ctx, item, options, 'tray'); }
	function songButton(ctx, item, options) { return collectButton(ctx, item, Object.assign({}, options, { kind: 'song' })); }
	function service(ctx) {
		var TS = root.TrueShuffle, http = ctx.http && ctx.http(), cache = ctx.cache && ctx.cache();
		return TS.artists.create({ it: http ? TS.sources.iTunes(http, cache) : null, dz: http ? TS.sources.deezerFinds(ctx.deezer(), cache) : null, M: TS.match, L: ctx.L, tracks: function () { return ctx.L.list(ctx.lib()); }, index: ctx.libIndex, map: ctx.findsMap, now: ctx.now });
	}
	function artwork(ctx, entry) {
		var h = ctx.h, pref = ctx.prefs && ctx.prefs();
		if (!ctx.demo && !ctx.thumb && (!pref || pref.art !== false) && entry.cover) return h('img', { class: 'ts-shelf-art', src: entry.cover, alt: '', loading: 'lazy' });
		return h('span', { class: 'ts-shelf-art ts-shelf-art-fallback', aria: { hidden: 'true' }, text: entry.title.charAt(0).toUpperCase() });
	}
	function removeEntry(ctx, bucket, entry, render) {
		var at = read(ctx)[bucket].findIndex(function (e) { return e.key === entry.key; });
		change(ctx, function (s) { return setEntry(s, bucket, entry, false); }); render();
		ctx.U.toast('Removed ' + entry.title + '.', { action: 'Undo', onAction: function () {
			change(ctx, function (s) { if (!s[bucket].some(function (e) { return e.key === entry.key; })) s[bucket].splice(Math.max(0, Math.min(at, s[bucket].length)), 0, entry); return s; }); render();
		} });
	}
	function albumCard(ctx, entry, options) {
		options = options || {}; var h = ctx.h, al = entry.release, card = h('article', { class: 'ts-shelf-card', data: { shelfKey: entry.key } });
		var title = h('a', { class: 'ts-shelf-card-title', href: entry.href || hrefFor(al, entry.artist) }, [artwork(ctx, entry), h('span', { text: entry.title })]); card.appendChild(title);
		card.appendChild(h('p', { class: 'ts-muted', text: entry.artist + ' / ' + (al.type === 'ep' ? 'EP' : al.type || 'album') + (al.date || al.year ? ' / ' + (al.date || al.year) : '') }));
		var actions = h('div', { class: 'ts-shelf-actions' }); actions.appendChild(albumButton(ctx, al, { artist: entry.artist, href: entry.href })); actions.appendChild(collectButton(ctx, al, { kind: 'album', artist: entry.artist, href: entry.href }));
		if (options.extra) actions.appendChild(options.extra); card.appendChild(actions); return card;
	}
	function playlistDialog(ctx, entries, done) {
		var closed = false, controller = new AbortController();
		var h = ctx.h, d = ctx.U.openDialog({ title: 'Make a discovery playlist', onClose: function () { closed = true; controller.abort(); } }), form = h('form'), inp = h('input', { class: 'kit-input', value: 'New discoveries', maxlength: '120', aria: { label: 'Playlist name' } }), note = h('p', { class: 'ts-muted', role: 'status', text: 'Selected releases expand into songs. Missing songs are found on YouTube only after you continue; each search can use 100 units. Unresolved songs stay in the tray. Your current playback stays as it is.' });
		form.appendChild(h('label', { class: 'ts-field' }, [h('span', { text: 'Playlist name' }), inp])); form.appendChild(note);
		var go = ctx.U.btn({ label: 'Find songs & create', variant: 'primary', type: 'submit' }), cancel = ctx.U.btn({ label: 'Cancel', variant: 'secondary', on: { click: d.close } }); form.appendChild(h('div', { class: 'ts-shelf-actions' }, [go, cancel])); d.body.appendChild(form); inp.focus(); inp.select();
		form.addEventListener('submit', function (event) {
			event.preventDefault(); if (!inp.value.trim() || go.disabled) { inp.focus(); return; }
			ctx.U.btnState(go, { busy: true });
			note.setAttribute('tabindex', '-1'); note.focus();
			resolveEntries(ctx, entries, function (message) { if (!closed) note.textContent = message; }, controller.signal).then(function (r) {
				if (closed) return;
				if (!r.ids.length) { note.textContent = 'No playable songs were found. Nothing was added to your library or playlists. Try a different selection or open Settings for YouTube access.'; ctx.U.btnState(go, { busy: false }); cancel.disabled = false; return; }
				var lib = ctx.lib(), L = ctx.L, now = stamp(ctx), changed = [];
				r.found.forEach(function (x) {
					if (lib.tracks[x.id]) return;
					if (!lib.playlists['local:discovered']) L.setPlaylist(lib, { id: 'local:discovered', title: 'Discovered', privacy: 'local', special: 'local' });
					L.upsert(lib, [{ id: x.id, title: x.video.title || x.find.artist + ' - ' + x.find.title, channel: x.video.channel || '', channelId: x.video.channelId || '', durationSec: x.video.durationSec || x.find.durationSec || 0, embeddable: true }], { playlistId: 'local:discovered', now: now });
					L.edit(lib, x.id, { title: x.find.title, artist: x.find.artist, at: now }); changed.push(x.id);
				});
				var save = changed.length && ctx.changed ? ctx.changed(changed, true) : null, li = ctx.lists.add(r.ids, inp.value.trim());
				return Promise.resolve(save).then(function () { d.close(); if (done) done(); if (ctx.say) ctx.say('Created ' + li.name + ' with ' + r.ids.length + ' songs. ' + r.unresolved + ' could not be resolved; the tray is kept.'); ctx.nav('#/list/' + encodeURIComponent(li.id)); });
			}).catch(function (err) { if (closed) return; note.textContent = 'Could not finish: ' + (err && err.message || err); ctx.U.btnState(go, { busy: false }); cancel.disabled = false; });
		});
	}
	function resolveEntries(ctx, entries, progress, signal) {
		var TS = root.TrueShuffle, artists = service(ctx), engine = ctx.engine(), all = [], missingAlbums = 0;
		var chain = Promise.resolve(); entries.forEach(function (entry) { chain = chain.then(function () {
			if (signal && signal.aborted) return;
			if (entry.kind === 'song') { all.push(entry.find); return; }
			if (progress) progress('Reading ' + entry.title + '...');
			var release = entry.release;
			if (ctx.demo && !Array.isArray(release.tracks)) {
				// Metadata-only demo bookmarks must recover invented tracks locally;
				// their made-up store IDs must never reach a real provider.
				var demo = artists.demo(ctx.L.normArtist(entry.artist), ctx.lib()), dg = demo && demo.discography;
				var candidates = dg ? [].concat(dg.albums || [], dg.eps || [], dg.singles || [], dg.compilations || []) : [];
				release = candidates.filter(function (al) { return al.key === entry.release.key || (al.source === entry.release.source && String(al.id) === String(entry.release.id)); })[0];
				if (!release || !Array.isArray(release.tracks)) { missingAlbums++; return; }
			}
			return artists.albumTracks(release, { signal: signal }).then(function (r) { all = all.concat(r.tracks || []); }, function () { missingAlbums++; });
		}); });
		return chain.then(function () {
			var seen = Object.create(null), unique = all.filter(function (f) { var k = f.key || fold(f.artist) + ':' + fold(f.title); if (seen[k]) return false; seen[k] = true; return true; });
			var ids = [], found = [], failed = missingAlbums, jobs = Promise.resolve(); unique.forEach(function (f, index) { jobs = jobs.then(function () {
				if (signal && signal.aborted) return;
				if (progress) progress('Finding song ' + (index + 1) + ' of ' + unique.length + '...');
				var hit = f.mine && ctx.lib().tracks[f.mine] ? { id: f.mine } : TS.match.inLibrary(ctx.libIndex(), f);
				if (hit && hit.id && ctx.lib().tracks[hit.id] && ctx.L.playable(ctx.lib().tracks[hit.id])) { ids.push(hit.id); return; }
				if (ctx.demo || (!f.videoId && !(ctx.canRead && ctx.canRead()))) { failed++; return; }
				return engine.resolve(f, { allow: 'search', signal: signal }).then(function (r) { if (!r || !r.videoId) { failed++; return; } ids.push(r.videoId); found.push({ id: r.videoId, find: f, video: r.video || {} }); }, function () { failed++; });
			}); });
			return jobs.then(function () { return { ids: ids.filter(function (id, i) { return ids.indexOf(id) === i; }), found: found, unresolved: failed }; });
		});
	}
	function inbox(view, ctx, options) {
		options = options || {}; var h = ctx.h, query = options.query || new URLSearchParams(), artist = options.artist || query.get('artist') || '', type = query.get('releaseType') || 'all', onlyNew = query.get('checked') !== 'all', status = h('p', { class: 'ts-muted', role: 'status' }), rows = h('div', { class: 'ts-shelf-grid' });
		if (!options.embedded) view.appendChild(h('h2', { text: 'Release inbox' }));
		view.appendChild(h('p', { class: 'ts-muted', text: 'Recent and upcoming releases from artists you chose. Opening a release marks it checked. Checking for new releases happens when you ask.' }));
		var controls = h('div', { class: 'ts-shelf-tools' }), select = h('select', { class: 'kit-input', aria: { label: 'Release type' } });
		[['all', 'All release types'], ['album', 'Albums'], ['ep', 'EPs'], ['single', 'Singles'], ['compilation', 'Compilations']].forEach(function (p) { select.appendChild(h('option', { value: p[0], text: p[1] })); }); select.value = type;
		var toggle = ctx.U.btn({ label: 'Unseen only', variant: 'chip', pressed: onlyNew, on: { click: function () { onlyNew = !onlyNew; ctx.U.btnState(toggle, { pressed: onlyNew }); remember(); draw(); } } });
		var check = ctx.U.btn({ label: 'Check releases', icon: 'refresh', variant: 'primary', on: { click: checkReleases } }); controls.appendChild(check); controls.appendChild(select); controls.appendChild(toggle); view.appendChild(controls); view.appendChild(status); view.appendChild(rows);
		select.addEventListener('change', function () { type = select.value; remember(); draw(); });
		function remember() { if (!ctx.replaceRoute) return; var q = new URLSearchParams(query.toString()); if (!options.embedded) q.set('tab', 'inbox'); if (type === 'all') q.delete('releaseType'); else q.set('releaseType', type); if (onlyNew) q.delete('checked'); else q.set('checked', 'all'); ctx.replaceRoute((options.base || '#/listening-shelf') + '?' + q.toString()); }
		function draw(message) {
			ctx.clear(rows); var s = read(ctx), follows = chosenNames(ctx).map(fold);
			function relevant(e) { return artist ? fold(e.artist) === fold(artist) : follows.indexOf(fold(e.artist)) >= 0; }
			var relevantReleases = s.inbox.filter(relevant), list = relevantReleases.filter(function (e) { return (type === 'all' || e.release.type === type) && (!onlyNew || !s.checked[e.key]); });
			status.textContent = message || list.length + ' releases shown / ' + relevantReleases.filter(function (e) { return !s.checked[e.key]; }).length + ' unseen';
			list.forEach(function (entry) {
				var checked = !!s.checked[entry.key], b = ctx.U.btn({ label: checked ? 'Mark unseen' : 'Mark checked', variant: 'ghost', size: 'sm', on: { click: function () { change(ctx, function (next) { if (checked) delete next.checked[entry.key]; else next.checked[entry.key] = stamp(ctx); return next; }); draw(); } } });
				var card = albumCard(ctx, entry, { extra: b }); if (!checked) card.classList.add('is-unseen'); card.querySelector('.ts-shelf-card-title').addEventListener('click', function () { markChecked(ctx, entry.release, { artist: entry.artist }); }); rows.appendChild(card);
			});
			if (!list.length) rows.appendChild(h('p', { class: 'ts-shelf-empty', text: relevantReleases.length ? 'No releases match these filters. Show checked releases or choose another type.' : 'No releases checked yet. Keep artists in Discover, then check their recent releases here.' }));
		}
		function checkReleases() {
			var TS = root.TrueShuffle, names = artist ? [artist] : TS.artistDiscovery.chosen(ctx), s = read(ctx), seen = Object.create(null);
			names = names.filter(function (name) { var key = fold(name); if (!key || seen[key]) return false; seen[key] = true; return true; }).sort(function (a, b) { return (s.checks[fold(a)] || 0) - (s.checks[fold(b)] || 0); });
			if (!names.length) { status.textContent = 'Choose artists in Discover first. Their releases will appear here.'; return; }
			var batch = names.slice(0, 8), api = service(ctx), failures = 0, completed = 0, controller = new AbortController(); ctx.U.btnState(check, { busy: true });
			var chain = Promise.resolve(); batch.forEach(function (name) { chain = chain.then(function () {
				if (!view.isConnected) { controller.abort(); return; }
				status.textContent = 'Checking ' + name + ' (' + (completed + 1) + '/' + batch.length + ')...';
				var demo = ctx.demo ? api.demo(ctx.L.normArtist(name), ctx.lib()) : null;
				var get = ctx.demo ? Promise.resolve(demo ? demo.discography : null) : api.find({ name: name, key: ctx.L.normArtist(name) }, { signal: controller.signal }).then(function (who) { return who ? api.discography(who, { signal: controller.signal }) : null; });
				return get.then(function (dg) {
					completed++; if (!dg) { failures++; return; }
					var releases = [].concat(dg.albums || [], dg.eps || [], dg.singles || [], dg.compilations || []);
					if (ctx.demo) releases = releases.slice(0, 2).map(function (al, index) { var r = Object.assign({}, al); r.date = new Date(stamp(ctx) + (index ? 14 : -14) * DAY).toISOString().slice(0, 10); r.year = +r.date.slice(0, 4); return r; });
					recordCatalog(ctx, name, releases);
				}, function () { completed++; failures++; });
			}); });
			chain.then(function () { if (!view.isConnected) return; ctx.U.btnState(check, { busy: false }); draw('Checked ' + batch.length + ' of ' + names.length + ' chosen artists' + (failures ? '; ' + failures + ' could not load' : '') + (names.length > 8 ? '. Check again for the next batch.' : '.')); });
		}
		draw();
	}
	function view(view, ctx, parts, query) {
		query = query || new URLSearchParams(); var h = ctx.h, tab = query.get('tab') || 'albums'; if (['albums', 'tray', 'inbox'].indexOf(tab) < 0) tab = 'albums';
		ctx.ui.headerBlock(view, { kicker: 'Discovery', title: 'Your listening shelf', art: false, blurb: 'Keep an album for another day, collect this session\'s finds, and catch up on releases from artists you chose.' });
		var c = summary(ctx), nav = h('nav', { class: 'ts-shelf-tabs', aria: { label: 'Listening shelf' } });
		[['albums', 'Want to hear', c.albums], ['tray', 'Discovery tray', c.tray], ['inbox', 'Release inbox', c.unseen]].forEach(function (p) { nav.appendChild(h('a', { class: 'ts-chip' + (p[0] === tab ? ' is-on' : ''), href: '#/listening-shelf?tab=' + p[0], text: p[1] + ' ' + p[2], aria: { current: p[0] === tab ? 'page' : null } })); }); view.appendChild(nav);
		if (ctx.bus && ctx.bus.on) { var offNav = ctx.bus.on('discovery-shelf', function () { if (!nav.isConnected) { offNav(); return; } var latest = summary(ctx); [['Want to hear', latest.albums], ['Discovery tray', latest.tray], ['Release inbox', latest.unseen]].forEach(function (p, index) { nav.children[index].textContent = p[0] + ' ' + p[1]; }); }); }
		if (session[storageKey(ctx)] && session[storageKey(ctx)].temporary) view.appendChild(h('p', { class: 'ts-muted', role: 'status', text: 'Storage is unavailable. This shelf lasts for this tab only.' }));
		if (tab === 'inbox') { inbox(view, ctx, { query: query }); return; }
		var rootNode = h('section'), selected = Object.create(null), renderedKeys = '', scheduled = false; view.appendChild(rootNode);
		function draw() {
			ctx.clear(rootNode); var list = read(ctx)[tab], tools = h('div', { class: 'ts-shelf-tools' }); renderedKeys = list.map(function (e) { return e.key; }).join('|');
			if (tab === 'tray') {
				rootNode.appendChild(h('p', { class: 'ts-muted', text: 'Select the songs and releases worth keeping. Making a playlist leaves your current playback and the rest of this tray in place.' }));
				var create = ctx.U.btn({ label: 'Make playlist', variant: 'primary', disabled: !list.some(function (e) { return selected[e.key]; }), on: { click: function () { playlistDialog(ctx, list.filter(function (e) { return selected[e.key]; }), draw); } } });
				tools.appendChild(ctx.U.btn({ label: list.length && list.every(function (e) { return selected[e.key]; }) ? 'Select none' : 'Select all', variant: 'secondary', disabled: !list.length, on: { click: function () { var all = list.every(function (e) { return selected[e.key]; }); list.forEach(function (e) { selected[e.key] = !all; }); draw(); } } })); tools.appendChild(create); rootNode.appendChild(tools);
			}
			var grid = h('div', { class: 'ts-shelf-grid' }); rootNode.appendChild(grid);
			list.forEach(function (entry) {
				var card = entry.kind === 'album' ? albumCard(ctx, entry) : h('article', { class: 'ts-shelf-card', data: { shelfKey: entry.key } }, [h('h3', { text: entry.title }), h('p', { class: 'ts-muted', text: entry.artist }), ctx.U.btn({ label: 'Play song', icon: 'play', variant: 'secondary', on: { click: function () { root.TrueShuffle.media.play(ctx, entry.find, 'now'); } } })]);
				if (tab === 'tray') { var check = h('input', { type: 'checkbox', checked: !!selected[entry.key] }); var label = h('label', { class: 'ts-shelf-select' }, [check, h('span', { text: 'Select ' + entry.title })]); check.addEventListener('change', function () { selected[entry.key] = check.checked; var button = tools.querySelector('.ts-btn--primary'); if (button) button.disabled = !list.some(function (e) { return selected[e.key]; }); ctx.U.btnState(tools.querySelector('.ts-btn--secondary'), { label: list.every(function (e) { return selected[e.key]; }) ? 'Select none' : 'Select all' }); }); card.insertBefore(label, card.firstChild); }
				card.appendChild(ctx.U.btn({ label: 'Remove', variant: 'ghost', size: 'sm', on: { click: function () { delete selected[entry.key]; removeEntry(ctx, tab, entry, draw); } } })); grid.appendChild(card);
			});
			if (!list.length) grid.appendChild(h('p', { class: 'ts-shelf-empty' }, [tab === 'albums' ? 'No albums saved yet. Use Want to hear on an album or release.' : 'Your discovery tray is empty. Use Collect on songs and albums while exploring.', ' ', h('a', { href: '#/for-you', text: 'Find music' })]));
		}
		draw();
		if (ctx.bus && ctx.bus.on) { var offView = ctx.bus.on('discovery-shelf', function () {
			if (!rootNode.isConnected) { offView(); return; } if (scheduled) return; scheduled = true;
			setTimeout(function () {
				scheduled = false; if (!rootNode.isConnected) return;
				if (read(ctx)[tab].map(function (e) { return e.key; }).join('|') === renderedKeys) return;
				var active = document.activeElement, ownFocus = rootNode.contains(active), card = active && active.closest ? active.closest('[data-shelf-key]') : null, key = card && card.getAttribute('data-shelf-key');
				draw(); if (!ownFocus) return;
				var cards = [].slice.call(rootNode.querySelectorAll('[data-shelf-key]')), next = cards.filter(function (el) { return el.getAttribute('data-shelf-key') === key; })[0] || cards[0], target = next && next.querySelector('a,button,input');
				if (target) target.focus(); else { rootNode.setAttribute('tabindex', '-1'); rootNode.focus(); }
			}, 0);
		}); }
	}
	return { empty: empty, normalize: normalize, pack: pack, setEntry: setEntry, observe: observe, counts: counts, summary: summary, read: read, albumButton: albumButton, collectButton: collectButton, songButton: songButton, recordCatalog: recordCatalog, markChecked: markChecked, inbox: inbox, view: view, resolveEntries: resolveEntries };
});
