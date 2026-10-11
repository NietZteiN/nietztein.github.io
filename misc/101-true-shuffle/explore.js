/*
 * True Shuffle: Explore. Any song, from the library or found, as a door to more
 * music: its anime or series and the songs you lack from it, its YouTube Mix, its
 * artist or band with their albums, songs like it by other artists, its channel's
 * uploads, and the library's own songs close to it. One lane each, most specific
 * first; each loads on its own (lanes.js) and says why when it cannot.
 *
 *     X.parseSeed(route) -> { kind: 'track', id } | { kind: 'find', key } | null
 *     X.seedOf(ref, ctx) -> seed | null       the song behind a route, as one shape
 *     X.order(seed) -> ['work', 'mix', 'artist', 'similar', 'channel', 'library'] (those that apply)
 *     X.remember(find) / X.recall(key)         a found song to explore, kept for the session
 *     X.hrefOf(item) -> '#/explore/...'        where exploring a song goes
 *     X.trail() -> [{ href, title }]           the songs explored last, at most five
 *     X.artistSeed(artist) -> seed             an artist page's lanes, without a song
 *     X.section(el, ctx, seed, laneIds)         some lanes inside another page
 *     X.view(view, ctx, parts, query)          #/explore/<id>, #/explore/find/<key>
 *     X.panel(box, ctx, { id, force })         the now-playing panel's Explore tab
 *
 * UMD: window.TrueShuffle.explore in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.explore = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var LANES = ['work', 'mix', 'artist', 'similar', 'channel', 'library'];
	var TRAIL_MAX = 5, TRAIL_KEY = 'ts.explore.trail';
	function mod(name) { return root.TrueShuffle && root.TrueShuffle[name]; }
	function fold(s) { var M = mod('match'); return M && M.fold ? M.fold(String(s || '')) : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

	// ---- The seed: what is explored -----------------------------------------------------------------

	// #/explore/<library id> or #/explore/find/<find key>
	function parseSeed(route) {
		var p = route && route.parts ? route.parts : [];
		if (p[0] !== 'explore') return null;
		if (p[1] === 'find' && p[2]) return { kind: 'find', key: String(p[2]) };
		if (p[1]) return { kind: 'track', id: String(p[1]) };
		return null;
	}

	// Found songs explored this session, by key (a find has no page of its own).
	var found = {};
	function remember(f) {
		if (!f || !f.key) return;
		found[f.key] = f;
		try { var all = JSON.parse(root.sessionStorage.getItem('ts.explore.finds') || '{}'); all[f.key] = f; var ks = Object.keys(all); if (ks.length > 60) delete all[ks[0]]; root.sessionStorage.setItem('ts.explore.finds', JSON.stringify(all)); } catch (e) { /* a private window: memory only */ }
	}
	function recall(key) {
		if (found[key]) return found[key];
		try { var all = JSON.parse(root.sessionStorage.getItem('ts.explore.finds') || '{}'); if (all[key]) { found[key] = all[key]; return all[key]; } } catch (e) { /* none */ }
		return null;
	}
	function hrefOf(item) {
		if (!item) return '#/';
		if (item.kind === 'artist') return '#/artist/' + encodeURIComponent(item.artistKey || '');
		var id = item.mine || (item.track && item.track.id) || (item.kind === 'track' ? item.id : null);
		if (id) return '#/explore/' + encodeURIComponent(id);
		var f = item.find || item;
		remember(f);
		return '#/explore/find/' + encodeURIComponent(f.key);
	}

	// One shape for a library track and a found song.
	function fromTrack(t, ctx) {
		var W = ctx.words;
		return { kind: 'track', id: t.id, track: t, find: null, videoId: t.id, title: W.title(t), artist: t.artist || (t.guess && t.guess.artist) || '', sure: !!t.artist,
			artistKey: t.artistKey || '', native: t.artistNative || '', titleAlt: t.titleAlt || '', work: t.work || '', role: t.role || '', year: t.year || 0,
			channel: t.channel || '', channelId: t.channelId || '', scene: t.scene || '', lang: t.lang || '', durationSec: t.durationSec || 0 };
	}
	function fromFind(f, ctx) {
		var en = ctx.engine && ctx.engine(), light = f.videoId && en ? en.track(f.videoId) : null;
		return { kind: 'find', id: null, track: null, find: f, light: light, videoId: f.videoId || null, title: f.title || (light && ctx.words.title(light)) || '',
			artist: f.artist || (light && light.artist) || '', sure: !!f.artist, artistKey: '', native: f.artistNative || '', titleAlt: f.titleAlt || '',
			work: f.work || (light && light.work) || '', role: f.role || '', year: f.year || 0, channel: f.channel || (light && light.channel) || '',
			channelId: f.channelId || (light && light.channelId) || '', scene: '', lang: '', durationSec: f.durationSec || 0 };
	}
	function seedOf(ref, ctx) {
		if (!ref) return null;
		if (ref.kind === 'track') { var t = ctx.trackOf(ref.id); if (!t) return null; return ctx.lib().tracks[t.id] ? fromTrack(t, ctx) : fromFind((ctx.engine() && ctx.engine().find(t.id)) || { key: 'v:' + t.id, videoId: t.id, title: ctx.words.title(t), artist: t.artist, channel: t.channel, channelId: t.channelId }, ctx); }
		var f = recall(ref.key);
		if (!f && /^v:/.test(ref.key)) { var id = ref.key.slice(2), lt = ctx.trackOf(id); if (lt) return ctx.lib().tracks[id] ? fromTrack(lt, ctx) : fromFind((ctx.engine() && ctx.engine().find(id)) || { key: ref.key, videoId: id, title: ctx.words.title(lt), artist: lt.artist, channel: lt.channel, channelId: lt.channelId }, ctx); }
		return f ? fromFind(f, ctx) : null;
	}

	// The lanes a seed has, most specific first.
	function order(seed) {
		if (!seed) return [];
		var out = [];
		if (seed.work || seed.scene === 'anime' || (!seed.scene && seed.lang === 'ja')) out.push('work');
		if (seed.videoId) out.push('mix');
		if (seed.artist) out.push('artist');
		out.push('similar');
		if (seed.channelId && !/\s-\sTopic$/i.test(seed.channel || '')) out.push('channel');
		if (seed.track) out.push('library');
		return out;
	}

	// ---- The trail: the songs explored last ------------------------------------------------------------

	function trail() { try { var t = JSON.parse(root.sessionStorage.getItem(TRAIL_KEY) || '[]'); return Array.isArray(t) ? t : []; } catch (e) { return []; } }
	function step(href, title) {
		var t = trail().filter(function (x) { return x.href !== href; });
		t.push({ href: href, title: title });
		t = t.slice(-TRAIL_MAX);
		try { root.sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t)); } catch (e) { /* memory only */ }
		return t;
	}

	// ---- The data behind the lanes -------------------------------------------------------------------

	var inst = { ctx: null };
	function deps(ctx) {
		if (inst.ctx === ctx && inst.works) return inst;
		var Src = mod('sources'), M = mod('match'), http = ctx.http ? ctx.http() : null, cache = ctx.cache ? ctx.cache() : null;
		var common = { M: M, L: ctx.L, index: function () { return ctx.libIndex ? ctx.libIndex() : M.index(ctx.L.list(ctx.lib())); }, tracks: function () { return ctx.L.list(ctx.lib()); }, map: ctx.findsMap || null, now: ctx.now };
		inst = { ctx: ctx };
		if (Src && http) {
			inst.at = Src.animeThemes(http, cache);
			inst.it = Src.iTunes(http, cache);
			inst.lfm = Src.lastFm(http, cache, function () { return ctx.lastfmKey ? ctx.lastfmKey() : ''; });
			inst.oe = Src.oEmbed(http, cache);
			inst.dz = ctx.deezer ? Src.deezerFinds(ctx.deezer(), cache) : null;
		}
		var Wk = mod('works'), Ar = mod('artists');
		inst.works = Wk ? Wk.create(Object.assign({ at: inst.at || null, it: inst.it || null }, common)) : null;
		inst.artists = Ar ? Ar.create(Object.assign({ it: inst.it || null, dz: inst.dz || null, at: inst.at || null }, common)) : null;
		return inst;
	}
	// A seed as the track shape works.js and artists.js read.
	function asTrack(seed) {
		if (seed.track) return seed.track;
		return { id: seed.videoId || seed.find.key, title: seed.title, titleAlt: seed.titleAlt, artist: seed.artist, artistNative: seed.native, work: seed.work, role: seed.role, scene: seed.scene, lang: seed.lang, durationSec: seed.durationSec, channel: seed.channel, channelId: seed.channelId, guess: { artist: '', rule: 'none' } };
	}
	function mineOf(ctx, f) {
		var M = mod('match');
		if (f.mine) return f.mine;
		if (f.videoId && ctx.lib().tracks[f.videoId]) return f.videoId;
		var hit = M && M.inLibrary ? M.inLibrary(ctx.libIndex ? ctx.libIndex() : M.index(ctx.L.list(ctx.lib())), f) : null;
		return hit ? hit.id || null : null;
	}
	function play(ctx, items, label, href, mode) {
		var en = ctx.engine(), finds = items.map(function (x) { return x.find || x; });
		if (!finds.length) return;
		var lib = ctx.lib(), mine = finds.every(function (f) { return f.mine || (f.videoId && lib.tracks[f.videoId]); });
		if (mine) { var ids = finds.map(function (f) { return f.mine || f.videoId; }); if (mode === 'later') ctx.play.later(ids); else if (mode === 'next') ctx.play.next(ids); else ctx.play.from(ids, 0, { label: label, href: href }); return; }
		if (!en) { ctx.say('Playing found songs needs the discovery engine.'); return; }
		if (mode === 'later' || mode === 'next') { finds.forEach(function (f) { ctx.play.find(f, mode); }); return; }
		en.list(finds, { label: label, href: href, searchCap: 10 });
	}
	function shuffle(arr, ctx) {
		var S = ctx.S, rand = S && S.cryptoRng ? S.cryptoRng() : null, out = arr.slice();
		for (var i = out.length - 1; i > 0; i--) { var j = rand && rand.int ? rand.int(i + 1) : Math.floor(Math.random() * (i + 1)); var x = out[i]; out[i] = out[j]; out[j] = x; }
		return out;
	}

	// ---- The lanes ----------------------------------------------------------------------------------------

	// Each returns a lanes.js spec for a seed; `compact` is the now-playing panel (3 rows, no players).
	function workLane(ctx, seed, o) {
		var D = deps(ctx), W = ctx.words, h = ctx.h, U = ctx.U, filter = 'all';
		return {
			id: 'work', title: seed.work ? 'From ' + seed.work : 'From its anime', badge: 'anime', layout: 'groups', limit: o.compact ? 3 : 0, key: 'x:work:' + (seed.id || seed.find.key),
			seeAll: o.compact ? { href: hrefOf(seed) + '?lane=work', label: 'See all' } : null,
			unavailable: function () { return D.works ? null : { text: 'Finding the anime needs works.js.', fix: null }; },
			empty: 'AnimeThemes does not know an anime with this song.',
			load: function (signal) {
				if (ctx.demo) { var d = D.works.demo(asTrack(seed), ctx.lib()); return Promise.resolve(d ? shapeWork(ctx, d.found, d.franchise) : { items: [] }); }
				return D.works.workOf(asTrack(seed), { signal: signal }).then(function (fw) {
					if (!fw) return { items: [] };
					return D.works.franchise(fw, { signal: signal }).then(function (fr) { return shapeWork(ctx, fw, fr); });
				});
			},
			actions: function (data) {
				if (!data || !data.songs || !data.songs.length) return [];
				var mine = data.songs.filter(function (f) { return f.mine; }), missing = data.songs.filter(function (f) { return !f.mine; });
				var label = data.title, href = hrefOf(seed) + '?lane=work';
				var out = [];
				if (mine.length) out.push(U.btn({ icon: 'play', label: 'Play yours (' + mine.length + ')', variant: 'secondary', size: 'sm', on: { click: function () { ctx.play.from(mine.map(function (f) { return f.mine; }), 0, { label: label, href: href }); } } }));
				if (missing.length && !o.compact) out.push(U.btn({ icon: 'queue-add', label: 'Add the ' + missing.length + ' missing to the queue', variant: 'secondary', size: 'sm', on: { click: function () { play(ctx, missing, label + ': the ones you lack', href); } } }));
				if (data.found && !data.found.sure && !o.compact) out.push(U.btn({ icon: 'close', label: 'Not this anime', variant: 'ghost', size: 'sm', on: { click: function () { D.works.reject(asTrack(seed), data.found.anime.slug).then(function () { ctx.redraw(); }); } } }));
				return out;
			},
			render: o.compact ? null : function (body, data) {
				var prog = h('div', { class: 'ts-x-prog' }, [
					h('span', { class: 'ts-x-progbar', style: { '--p': String(data.total ? Math.round(100 * data.have / data.total) : 0) } }),
					h('span', { class: 'ts-muted', text: 'You have ' + data.have + ' of ' + W.plural(data.total, 'song') + (data.found && !data.found.sure ? ' ' + W.DOT + ' probably ' + data.found.anime.name : '') })
				]);
				body.appendChild(prog);
				var chips = h('div', { class: 'ts-chips ts-x-filters', role: 'group', aria: { label: 'Which songs' } });
				var list = h('div');
				[['all', 'All'], ['missing', 'Missing'], ['yours', 'Yours'], ['OP', 'Openings'], ['ED', 'Endings'], ['insert', 'Inserts']].forEach(function (c) {
					var n = c[0] === 'all' ? data.songs.length : data.songs.filter(function (f) { return pick(f, c[0]); }).length;
					if (!n) return;
					chips.appendChild(U.btn({ variant: 'chip', label: c[1] + ' ' + n, pressed: filter === c[0], on: { click: function () { filter = c[0]; ctx.clear(list); draw(); } } }));
				});
				body.appendChild(chips);
				body.appendChild(list);
				function pick(f, k) { return k === 'missing' ? !f.mine : k === 'yours' ? !!f.mine : k === 'OP' || k === 'ED' ? f.role === k : k === 'insert' ? f.role === 'insert' || f.role === 'IN' : true; }
				function draw() {
					[].slice.call(chips.children).forEach(function (b) { var k = (b.dataset.label || '').split(' ')[0]; ctx.U.btnState(b, { pressed: { All: 'all', Missing: 'missing', Yours: 'yours', Openings: 'OP', Endings: 'ED', Inserts: 'insert' }[k] === filter }); });
					data.groups.forEach(function (g) {
						var items = g.items.filter(function (f) { return pick(f, filter); });
						if (!items.length) return;
						list.appendChild(h('h3', { class: 'ts-x-gh', text: g.title }, g.sub ? [h('span', { class: 'ts-muted', text: ' ' + g.sub })] : null));
						var ol = h('ol', { class: 'ts-x-rows' });
						items.forEach(function (f) { ol.appendChild(mod('media').row(ctx, mod('media').item(f, ctx), { context: { label: data.title, href: hrefOf(seed) + '?lane=work' } })); });
						list.appendChild(ol);
					});
				}
				if (!chips.children.length) chips.hidden = true;
				draw();
			}
		};
	}
	function shapeWork(ctx, fw, fr) {
		var W = ctx.words;
		var songs = (fr.songs || []).map(function (f) { f.mine = f.mine || mineOf(ctx, f); return f; });
		var groups = (fr.entries || []).map(function (e) {
			var items = songs.filter(function (f) { return f.entry === e.name; });
			return { title: e.name, sub: [e.year ? String(e.year) : '', e.format && e.format !== 'TV' ? e.format : ''].filter(Boolean).join(' ' + W.DOT + ' '), items: items };
		}).filter(function (g) { return g.items.length; });
		var have = songs.filter(function (f) { return f.mine; }).length;
		return { title: fr.title || (fw.anime && fw.anime.name) || '', found: fw, songs: songs, groups: groups, items: songs, have: have, total: songs.length, note: fw.sure ? '' : 'Probably ' + fw.anime.name };
	}

	// YouTube's Mix of the song: read through a visible player, only when asked.
	function mixLane(ctx, seed, o, holder) {
		var D = deps(ctx), Ch = mod('channel'), asked = false, W = ctx.words;
		return {
			id: 'mix', title: 'YouTube Mix', sub: 'songs YouTube plays after this one', badge: 'mix', layout: 'rows', limit: 12, key: 'x:mix:' + seed.videoId,
			unavailable: function () {
				if (ctx.demo) return { text: 'The demo asks nothing of YouTube.', fix: null };
				if (!Ch || !Ch.readList) return { text: 'Reading a Mix needs channel.js.', fix: null };
				if (!asked) return { text: 'YouTube makes a Mix of songs that go with this one. Reading it shows a YouTube player here for a moment; nothing plays.', fix: { label: 'Read the YouTube Mix', icon: 'ytmix', run: function () { asked = true; } } };
				return null;
			},
			empty: 'YouTube gave no Mix for this song.',
			load: function (signal) {
				var box = holder.scout;
				box.hidden = false;
				return Ch.readList(box, 'RD' + seed.videoId, { videoId: seed.videoId }).then(function (ids) {
					box.hidden = true;
					ids = ids.filter(function (id) { return id !== seed.videoId; });
					if (!ids.length) return { items: [] };
					return (D.oe ? D.oe.videos(ids.slice(0, 40)) : Promise.resolve([])).then(function (answers) {
						var items = answers.filter(function (a) { return a.ok; }).map(function (a) { return { videoId: a.id, title: a.title, channel: a.channel, channelId: a.channelId || '' }; });
						var finds = Ch.uploadFinds(items, { have: function (v) { return !!ctx.lib().tracks[v]; }, find: mod('sources').find }).filter(function (f) { return f.music; });
						finds.forEach(function (f) { f.source = 'ytmix'; f.why = [['mix', seed.title]]; f.mine = ctx.lib().tracks[f.videoId] ? f.videoId : null; });
						return { items: finds, total: finds.length };
					});
				}, function (e) { box.hidden = true; throw e; });
			},
			actions: function (data) {
				if (!data || !data.items || !data.items.length) return [];
				return [ctx.U.btn({ icon: 'play', label: 'Play the Mix', variant: 'secondary', size: 'sm', on: { click: function () { play(ctx, data.items, 'Mix: ' + seed.title, hrefOf(seed) + '?lane=mix'); } } })];
			}
		};
	}

	// The artist or band: top songs, albums and EPs, singles, anime songs.
	function artistLane(ctx, seed, o) {
		var D = deps(ctx), h = ctx.h, U = ctx.U, W = ctx.words, tab = 'top';
		var who = seed.track ? { key: seed.artistKey, name: seed.artist, native: seed.native } : { key: fold(seed.artist), name: seed.artist, native: seed.native };
		return {
			id: 'artist', title: 'More by ' + seed.artist, badge: 'album', layout: o.compact ? 'rows' : 'cards', limit: o.compact ? 3 : 0, key: 'x:artist:' + fold(seed.artist),
			seeAll: o.compact ? { href: hrefOf(seed) + '?lane=artist', label: 'See all' } : null,
			unavailable: function () { return D.artists ? null : { text: 'Their albums need artists.js.', fix: null }; },
			empty: 'Apple\'s iTunes and Deezer do not know ' + seed.artist + '.',
			load: function (signal) {
				if (ctx.demo) { var d = D.artists.demo(who.key || fold(seed.artist), ctx.lib()); return Promise.resolve(d ? shapeArtist(ctx, d.found, d.discography) : { items: [] }); }
				return D.artists.find(who, { signal: signal }).then(function (fa) {
					if (!fa) return { items: [] };
					return D.artists.discography(fa, { signal: signal }).then(function (dg) { return shapeArtist(ctx, fa, dg); });
				});
			},
			actions: function (data) {
				if (!data || o.compact) return [];
				var out = [];
				if (data.found && !data.found.sure) out.push(U.btn({ icon: 'close', label: 'Not this artist', variant: 'ghost', size: 'sm', on: { click: function () { var c = data.found.itunes ? ['itunes', data.found.itunes.id] : data.found.deezer ? ['deezer', data.found.deezer.id] : null; if (c) D.artists.reject(who, c[0], c[1]).then(function () { ctx.redraw(); }); } } }));
				return out;
			},
			render: o.compact ? null : function (body, data) {
				var tabs = h('div', { class: 'ts-chips ts-x-tabs', role: 'tablist', aria: { label: 'Their music' } }), panel = h('div');
				var kinds = [['top', 'Top songs', data.dg.top], ['albums', 'Albums & EPs', data.dg.albums.concat(data.dg.eps)], ['singles', 'Singles', data.dg.singles], ['anime', 'Anime songs', data.dg.anime || []]].filter(function (k) { return k[2] && k[2].length; });
				if (!kinds.length) { body.appendChild(h('p', { class: 'ts-muted', text: 'Nothing found for ' + seed.artist + '.' })); return; }
				if (!kinds.some(function (k) { return k[0] === tab; })) tab = kinds[0][0];
				kinds.forEach(function (k) {
					tabs.appendChild(U.btn({ variant: 'chip', label: k[1] + ' ' + k[2].length, pressed: tab === k[0], aria: { selected: tab === k[0] ? 'true' : 'false' }, on: { click: function () { tab = k[0]; [].slice.call(tabs.children).forEach(function (b, i) { U.btnState(b, { pressed: kinds[i][0] === tab }); }); draw(); } } }));
				});
				body.appendChild(tabs);
				body.appendChild(panel);
				function draw() {
					ctx.clear(panel);
					var k = kinds.filter(function (x) { return x[0] === tab; })[0];
					if (tab === 'top' || tab === 'anime') {
						var ol = h('ol', { class: 'ts-x-rows' });
						k[2].slice(0, 25).forEach(function (f) { ol.appendChild(mod('media').row(ctx, mod('media').item(f, ctx), { context: { label: seed.artist, href: hrefOf(seed) + '?lane=artist' }, list: k[2] })); });
						panel.appendChild(ol);
						return;
					}
					var grid = h('div', { class: 'ts-grid is-cards' });
					k[2].forEach(function (al) { grid.appendChild(albumCard(ctx, al, seed)); });
					panel.appendChild(grid);
				}
				draw();
			}
		};
	}
	function shapeArtist(ctx, fa, dg) {
		dg = dg || {};
		['top', 'anime'].forEach(function (k) { (dg[k] || []).forEach(function (f) { f.mine = f.mine || mineOf(ctx, f); }); });
		['albums', 'eps', 'singles', 'compilations'].forEach(function (k) { dg[k] = dg[k] || []; });
		dg.top = dg.top || [];
		return { found: fa, dg: dg, items: dg.top, total: dg.top.length + dg.albums.length + dg.eps.length + dg.singles.length };
	}
	function albumCard(ctx, al, seed) {
		var W = ctx.words, U = ctx.U;
		var art = al.cover ? ctx.h('span', { class: 'ts-art' }, ctx.h('img', { src: al.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : U.swatch(30, al.title, '', 45);
		var sub = [al.year ? String(al.year) : '', al.type === 'ep' ? 'EP' : al.type === 'single' ? 'Single' : al.type === 'compilation' ? 'Compilation' : 'Album', al.trackCount ? W.plural(al.trackCount, 'song') : '', al.have != null ? al.have + ' yours' : ''].filter(Boolean).join(' ' + W.DOT + ' ');
		var c = ctx.ui.card({ href: '#', art: art, title: al.title, sub: sub, play: function () { albumDialog(ctx, al, seed, true); }, playLabel: 'Play ' + al.title });
		var a = c.querySelector('a');
		if (a) a.addEventListener('click', function (e) { e.preventDefault(); albumDialog(ctx, al, seed); });
		return c;
	}
	// An album, EP or single: its songs, which you have, and playing them.
	function albumDialog(ctx, al, seed, playNow) {
		var D = deps(ctx), h = ctx.h, U = ctx.U, W = ctx.words;
		var d = U.openDialog({ title: al.title, wide: true });
		var body = d.body;
		body.appendChild(h('p', { class: 'ts-muted', text: [seed.artist, al.year ? String(al.year) : '', al.type === 'ep' ? 'EP' : al.type === 'single' ? 'Single' : 'Album'].filter(Boolean).join(' ' + W.DOT + ' ') }));
		var acts = h('div', { class: 'ts-row-btns' }), ol = h('ol', { class: 'ts-x-rows' }), note = h('p', { class: 'ts-muted' });
		body.appendChild(acts);
		body.appendChild(note);
		body.appendChild(ol);
		ol.appendChild(h('li', { class: 'ts-ch-skel', aria: { hidden: 'true' } }));
		var get = ctx.demo && al.tracks ? Promise.resolve({ tracks: al.tracks, have: al.tracks.filter(function (f) { return f.mine; }).length, total: al.tracks.length }) : D.artists.albumTracks(al, {});
		get.then(function (r) {
			ctx.clear(ol);
			var tracks = (r.tracks || []).map(function (f) { f.mine = f.mine || mineOf(ctx, f); return f; });
			var have = tracks.filter(function (f) { return f.mine; }).length, label = al.title + ' (' + seed.artist + ')';
			var canFind = !!(ctx.canRead && ctx.canRead());
			note.textContent = 'You have ' + have + ' of ' + W.plural(tracks.length, 'song') + '.' + (have < tracks.length ? (canFind ? ' The others are found on YouTube when you play: the album\'s own list first (one search, about 101 units for all of them).' : ' Playing the others needs a sign-in or a YouTube API key (Settings).') : '');
			// the album's own YouTube list first (one search), when several of its songs need finding
			var unresolved = tracks.filter(function (f) { return !f.mine && !f.videoId; }).length, group = unresolved >= 4 && !!(ctx.canRead && ctx.canRead());
			function go(order) {
				var en = ctx.engine(), href = hrefOf(seed) + '?lane=artist';
				d.close();
				if (!group || !en || !en.resolveGroup) { play(ctx, order, label, href); return; }
				var job = ctx.job ? ctx.job('Finding ' + al.title + ' on YouTube' + W.ELL) : null;
				en.resolveGroup(order, { query: seed.artist + ' ' + al.title, title: al.title }).then(function (r) {
					if (job) job.done();
					play(ctx, order, label, href);
				}, function () { if (job) job.done(); play(ctx, order, label, href); });
			}
			acts.appendChild(U.btn({ icon: 'play', label: 'Play all', variant: 'primary', size: 'md', cost: group ? 101 : null, on: { click: function () { go(tracks); } } }));
			acts.appendChild(U.btn({ icon: 'shuffle', label: 'Shuffle', variant: 'secondary', size: 'md', on: { click: function () { go(shuffle(tracks, ctx)); } } }));
			acts.appendChild(U.btn({ icon: 'queue-add', label: 'Add to queue', variant: 'secondary', size: 'md', on: { click: function () { play(ctx, tracks, label, '', 'later'); ctx.say(W.plural(tracks.length, 'song') + ' added to the queue.'); } } }));
			tracks.forEach(function (f, i) { ol.appendChild(mod('media').row(ctx, mod('media').item(f, ctx), { index: i + 1, context: { label: label, href: hrefOf(seed) }, list: tracks })); });
			if (playNow) go(tracks);
		}, function (e) {
			ctx.clear(ol);
			var ex = mod('lanes') && mod('lanes').explain ? mod('lanes').explain(e) : { text: (e && e.message) || 'The songs could not be read.' };
			note.textContent = ex.text;
		});
	}

	// Songs like this one by other artists: Last.fm with the listener's key, else Deezer.
	function similarLane(ctx, seed, o) {
		var D = deps(ctx), key = ctx.lastfmKey ? ctx.lastfmKey() : '';
		return {
			id: 'similar', title: seed.kind === 'artist' ? 'Artists like ' + seed.artist : key ? 'Similar songs' : 'From artists like ' + (seed.artist || 'this'), sub: key ? 'from Last.fm' : 'from Deezer', badge: 'ext', layout: o.compact ? 'rows' : 'cards', limit: o.compact ? 3 : 12, key: 'x:similar:' + fold(seed.artist) + ':' + fold(seed.title),
			seeAll: o.compact ? { href: hrefOf(seed) + '?lane=similar', label: 'See all' } : null,
			unavailable: function () {
				if (ctx.demo) return { text: 'The demo asks no music services.', fix: null };
				if (!seed.artist) return { text: 'This song has no sure artist to start from.', fix: null };
				if (!key && !D.dz) return { text: 'Add a Last.fm key in Settings for songs like this one.', fix: { label: 'Open Settings', run: function () { ctx.nav('#/settings'); } } };
				return null;
			},
			empty: 'Nothing like it was found.',
			load: function (signal) {
				var lib = ctx.lib();
				function fresh(list) { return list.filter(function (f) { f.mine = mineOf(ctx, f); return !f.mine; }); }
				if (key && D.lfm && seed.kind === 'artist') return D.lfm.similarArtists(seed.artist, { limit: 6, signal: signal }).then(function (as) {
					return Promise.all(as.slice(0, 6).map(function (a) { return D.lfm.topTracks(a.name, { limit: 2, signal: signal }).then(null, function () { return []; }); })).then(function (lists) { var all = []; lists.forEach(function (l) { all = all.concat(l || []); }); return { items: fresh(all) }; });
				});
				if (key && D.lfm) return D.lfm.similarTracks(seed.artist, seed.title, { limit: 30, signal: signal }).then(function (fs) { return { items: fresh(fs) }; });
				return (D.artists ? D.artists.find(seed.track ? { key: seed.artistKey, name: seed.artist, native: seed.native } : { key: fold(seed.artist), name: seed.artist }, { signal: signal }) : Promise.resolve(null)).then(function (fa) {
					var dzId = fa && fa.deezer ? fa.deezer.id : null;
					if (!dzId || !D.dz) return { items: [] };
					return D.dz.related(dzId, { signal: signal }).then(function (rel) {
						var pick = rel.slice(0, 6);
						return Promise.all(pick.map(function (a) { return D.dz.top(a.id, 2, { signal: signal }).then(null, function () { return []; }); })).then(function (lists) {
							var all = [];
							lists.forEach(function (l) { all = all.concat(l || []); });
							return { items: fresh(all) };
						});
					});
				});
			}
		};
	}

	// The channel's uploads: with a sign-in or a key now; otherwise on the channel's own page.
	function channelLane(ctx, seed, o) {
		var Ch = mod('channel'), Src = mod('sources');
		var rank = Ch ? Ch.rank(ctx.L.list(ctx.lib()).filter(function (t) { return t.channelId === seed.channelId; }))[0] : null;
		return {
			id: 'channel', title: 'On ' + (seed.channel || 'its channel'), sub: rank && rank.curator ? 'a channel that finds music for you' : 'its YouTube channel', badge: 'channel', layout: 'rows', limit: o.compact ? 3 : 6, key: 'x:channel:' + seed.channelId,
			seeAll: { href: ctx.link('channel', seed.channelId), label: 'All its uploads' },
			unavailable: function () { return Ch ? null : { text: 'Channels need channel.js.', fix: null }; },
			empty: 'You have every upload of this channel.',
			load: function (signal) {
				var have = function (v) { return !!ctx.lib().tracks[v]; };
				if (ctx.demo) return Promise.resolve({ items: Ch.uploadFinds(Ch.demoUploads(seed.channelId, seed.channel, ctx.S.rng('channel-' + seed.channelId)), { channelId: seed.channelId, channel: seed.channel, have: have, find: Src.find }).filter(function (f) { return !f.mine && f.music; }) });
				if (!(ctx.canRead && ctx.canRead()) || !Src || !ctx.client || !ctx.client()) return Promise.resolve({ items: [], note: 'unread' });
				return Src.ytLists(ctx.client(), ctx.cache()).uploads(seed.channelId, { max: 50, signal: signal }).then(function (items) {
					var rule = ctx.lib().channelRules && ctx.lib().channelRules[seed.channelId];
					return { items: Ch.uploadFinds(items, { channelId: seed.channelId, channel: seed.channel, rule: rule, have: have, find: Src.find }).filter(function (f) { return !f.mine && f.music; }) };
				});
			},
			render: function (body, data) {
				if (data && data.note === 'unread') {
					body.appendChild(ctx.h('p', { class: 'ts-muted', text: 'Its uploads are read on the channel\'s own page (free, through YouTube\'s player).' }));
					body.appendChild(ctx.U.btn({ icon: 'channel', label: 'Open the channel', variant: 'secondary', size: 'sm', href: ctx.link('channel', seed.channelId) }));
					return;
				}
				var ol = ctx.h('ol', { class: 'ts-x-rows' });
				data.items.slice(0, o.compact ? 3 : 6).forEach(function (f) { ol.appendChild(mod('media').row(ctx, mod('media').item(f, ctx), { context: { label: seed.channel, href: ctx.link('channel', seed.channelId) }, compact: o.compact })); });
				body.appendChild(ol);
			}
		};
	}

	// The library's own songs close to this one (shuffle.js similar).
	function libraryLane(ctx, seed, o) {
		return {
			id: 'library', title: 'From your library', badge: 'library', layout: 'groups', limit: o.compact ? 4 : 0, key: 'x:library:' + seed.id,
			unavailable: function () { return ctx.similar ? null : { text: 'Not available here.', fix: null }; },
			empty: 'Nothing in the library is close enough to this one yet.',
			load: function () {
				var r = ctx.similar(seed.track), groups = [];
				var tog = (r.together || []).filter(function (x) { return x.n >= 2; }).slice(0, o.compact ? 3 : 6).map(function (x) { return x.t; });
				var work = (r.work || []).slice(0, o.compact ? 3 : 8);
				var close = (r.close || []).filter(function (x) { return work.indexOf(x.t) < 0; }).slice(0, o.compact ? 4 : 14);
				if (tog.length) groups.push({ title: 'You often play with it', items: tog });
				if (work.length) groups.push({ title: 'Also from ' + seed.work, items: work });
				if (close.length) groups.push({ title: 'Sounds close', items: close.map(function (x) { return x.t; }), whys: close.map(function (x) { return x.why; }) });
				var items = [];
				groups.forEach(function (g) { items = items.concat(g.items); });
				return Promise.resolve({ groups: groups, items: items });
			},
			actions: function (data) {
				if (!data || !data.items || !data.items.length) return [];
				var ids = data.items.map(function (t) { return t.id; });
				return [ctx.U.btn({ icon: 'queue-next', label: o.compact ? 'Queue them next' : 'Play them next', variant: 'secondary', size: 'sm', on: { click: function () { ctx.play.next(ids); } } })];
			}
		};
	}

	// A seed for an artist's own page: their lanes without a song.
	function artistSeed(a) {
		var t = a && a.tracks && a.tracks[0];
		return { kind: 'artist', id: null, track: null, find: null, videoId: null, title: a.name, artist: a.name, sure: true, artistKey: a.key, native: (t && t.artistNative) || '', titleAlt: '', work: '', role: '', year: 0, channel: '', channelId: '', scene: (t && t.scene) || '', lang: (t && t.lang) || '', durationSec: 0 };
	}
	// Some of a seed's lanes inside another page (the song's page, an artist's page).
	function section(el, ctx, seed, ids) {
		injectCss();
		var Lanes = mod('lanes');
		if (!seed || !Lanes) return [];
		var has = order(seed);
		return ids.filter(function (id) { return has.indexOf(id) >= 0; }).map(function (id) {
			var wrap = ctx.h('section', { class: 'ts-x-lane' }), body = ctx.h('div'), holder = { lane: null, scout: ctx.h('div', { class: 'ts-x-scout', hidden: true }) };
			wrap.appendChild(body);
			wrap.appendChild(holder.scout);
			el.appendChild(wrap);
			holder.lane = Lanes.mount(body, ctx, laneSpec(ctx, id, seed, { compact: false }, holder));
			return holder.lane;
		});
	}

	// ---- The page --------------------------------------------------------------------------------------------

	var css = false;
	function injectCss() {
		if (css || !root.document) return;
		css = true;
		var st = root.document.createElement('style');
		st.id = 'ts-explore-css';
		st.textContent = [
			'.ts-x-trail{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:center;margin:0 0 10px;font-size:13px;color:var(--text-2)}',
			'.ts-x-trail a{color:inherit;text-decoration:none;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.ts-x-trail a:hover{color:var(--text);text-decoration:underline}',
			'.ts-x-trail .is-here{color:var(--text);font-weight:650}',
			'.ts-x-jump{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 14px}',
			'.ts-x-lane{margin:0 0 26px;max-width:1000px;scroll-margin-top:72px}',
			'.ts-x-rows{list-style:none;margin:0;padding:0}',
			'.ts-x-gh{font-size:14px;font-weight:650;margin:14px 0 4px}',
			'.ts-x-prog{display:flex;align-items:center;gap:10px;margin:2px 0 10px}',
			'.ts-x-progbar{position:relative;flex:none;width:160px;height:6px;border-radius:3px;background:var(--ts-hover);overflow:hidden}',
			'.ts-x-progbar::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--p,0) * 1%);background:var(--ts-play,#1f5fd6);border-radius:3px}',
			'.ts-x-filters,.ts-x-tabs{margin:0 0 8px}',
			'.ts-x-scout{margin:8px 0}',
			'.ts-x-scout iframe{display:block;width:356px;height:200px;max-width:100%;border:0;border-radius:10px;background:#000}',
			'.ts-x-panel-head{display:flex;align-items:center;gap:8px;justify-content:space-between;margin:0 0 6px}',
			'.ts-x-panel-head .ts-context{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.ts-x-pill{display:flex;margin:0 0 8px}',
			'.ts-x-panel .ts-x-lane{margin:0 0 14px}'
		].join('\n');
		root.document.head.appendChild(st);
	}

	function laneSpec(ctx, id, seed, o, holder) {
		if (id === 'work') return workLane(ctx, seed, o);
		if (id === 'mix') return mixLane(ctx, seed, o, holder);
		if (id === 'artist') return artistLane(ctx, seed, o);
		if (id === 'similar') return similarLane(ctx, seed, o);
		if (id === 'channel') return channelLane(ctx, seed, o);
		return libraryLane(ctx, seed, o);
	}
	var JUMP = { work: 'Anime', mix: 'Mix', artist: 'Artist', similar: 'Similar', channel: 'Channel', library: 'Your library' };

	function view(el, ctx, parts, query) {
		injectCss();
		var h = ctx.h, U = ctx.U, W = ctx.words, Lanes = mod('lanes');
		var ref = parseSeed(ctx.route()), seed = seedOf(ref, ctx);
		if (!seed) {
			ctx.ui.headerBlock(el, { kicker: 'Explore', title: 'Nothing to explore', art: false, blurb: 'This song is not known here any more. Explore starts from any song: the compass on a song, or E while one plays.' });
			return;
		}
		var href = ref.kind === 'track' ? '#/explore/' + encodeURIComponent(seed.id) : '#/explore/find/' + encodeURIComponent(ref.key);
		var crumbs = step(href, seed.title);
		var tr = h('nav', { class: 'ts-x-trail', aria: { label: 'Explored' } }, [h('span', { text: 'Explore' })]);
		crumbs.forEach(function (c) { tr.appendChild(h('span', { aria: { hidden: 'true' }, text: '>' })); tr.appendChild(c.href === href ? h('span', { class: 'is-here', text: c.title, aria: { current: 'page' } }) : h('a', { href: c.href, text: c.title })); });

		var en = ctx.engine(), lib = ctx.lib(), t = seed.track;
		var art = t ? ctx.art(t, 'ts-hero-art') : U.art(seed.videoId || '', 210, seed.title, 'ts-hero-art', !!seed.videoId && !ctx.demo && ctx.prefs().art !== false, 45);
		var acts = [];
		acts.push(U.btn({ icon: 'play', label: 'Play', variant: 'primary', size: 'lg', on: { click: function () { if (t) ctx.play.now([t.id], { label: seed.title, href: href }); else ctx.play.find(seed.find, 'now'); } } }));
		var radioId = t ? t.id : (seed.videoId && en && en.track(seed.videoId) ? seed.videoId : null);
		if (radioId && en) acts.push(U.btn({ icon: 'radio', label: 'Start radio', variant: 'secondary', size: 'md', on: { click: function () { var r = +(root.ToyKit ? root.ToyKit.load('newRatio', 0.5) : 0.5); en.radio(radioId, { ratio: r, label: 'Radio: ' + seed.title, href: href }); } } }));
		if (t && ctx.like) acts.push(U.btn({ icon: 'heart', label: ctx.liked && ctx.liked(t.id) ? 'Liked' : 'Like', variant: 'secondary', size: 'md', pressed: !!(ctx.liked && ctx.liked(t.id)), on: { click: function (e) { ctx.like(t.id); U.btnState(e.currentTarget, { pressed: !!(ctx.liked && ctx.liked(t.id)), label: ctx.liked && ctx.liked(t.id) ? 'Liked' : 'Like' }); } } }));
		else if (!t && en) acts.push(U.btn({ icon: 'bookmark', label: en.isSaved(seed.find.key) ? 'Saved' : 'Save for later', variant: 'secondary', size: 'md', pressed: en.isSaved(seed.find.key), on: { click: function (e) { if (en.isSaved(seed.find.key)) en.unsave(seed.find.key); else en.save(seed.find); U.btnState(e.currentTarget, { pressed: en.isSaved(seed.find.key), label: en.isSaved(seed.find.key) ? 'Saved' : 'Save for later' }); } } }));
		if (t) acts.push(ctx.ui.smallBtn('info', 'Song details', function () { ctx.nav(ctx.link('track', t.id)); }));
		if (seed.videoId && !ctx.demo) acts.push(ctx.ui.smallBtn('external', 'Open on YouTube', function () { root.open('https://www.youtube.com/watch?v=' + encodeURIComponent(seed.videoId), '_blank', 'noopener'); }));
		var bits = [seed.artist, seed.work ? seed.work + (seed.role ? ' ' + seed.role : '') : '', seed.year ? String(seed.year) : ''].filter(Boolean);
		var hero = ctx.ui.headerBlock(el, { kicker: t ? 'Explore' : 'Explore a found song', title: seed.title || 'A song', meta: bits.join(' ' + W.DOT + ' '), artNode: art, hue: { h: 210, s: 45 }, actions: acts });
		// the trail sits in the header, above the kicker (the header bleeds over what is above it)
		var ht = hero && hero.querySelector('.ts-hero-text');
		if (ht) ht.insertBefore(tr, ht.firstChild);

		var ids = order(seed), jump = h('div', { class: 'ts-x-jump', role: 'navigation', aria: { label: 'Jump to' } });
		el.appendChild(jump);
		if (!Lanes) { el.appendChild(h('p', { class: 'ts-empty', text: 'Explore needs lanes.js.' })); return; }
		var mounted = [];
		ids.forEach(function (id) {
			var wrap = h('section', { class: 'ts-x-lane', id: 'x-lane-' + id }), holder = { lane: null, scout: h('div', { class: 'ts-x-scout', hidden: true }) };
			var body = h('div');
			wrap.appendChild(body);
			wrap.appendChild(holder.scout);
			el.appendChild(wrap);
			holder.lane = Lanes.mount(body, ctx, laneSpec(ctx, id, seed, { compact: false }, holder));
			mounted.push(holder.lane);
			jump.appendChild(U.btn({ variant: 'chip', label: JUMP[id], on: { click: function () { wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }));
		});
		var want = query && query.get ? query.get('lane') : '';
		if (want && root.document.getElementById('x-lane-' + want)) setTimeout(function () { var w = root.document.getElementById('x-lane-' + want); if (w) w.scrollIntoView({ block: 'start' }); }, 60);
		return { lanes: mounted, seed: seed };
	}

	// ---- The now-playing panel's Explore tab ---------------------------------------------------------------
	// It follows the song that is on, or stays pinned to one; it never rebuilds under the pointer:
	// a song change then shows a pill to switch.

	var tab = { id: null, pinned: false, lanes: [] };
	function panel(box, ctx, o) {
		injectCss();
		o = o || {};
		var h = ctx.h, U = ctx.U, Lanes = mod('lanes');
		var id = tab.pinned && tab.id ? tab.id : o.id;
		if (!o.force && id === tab.shown && box.firstChild) {
			if (!tab.pinned && o.id && o.id !== tab.id) offer(o.id);
			return;
		}
		if (!o.force && tab.shown && o.id !== tab.shown && box.matches && box.matches(':hover') && !tab.pinned) { offer(o.id); return; }
		tab.lanes.forEach(function (l) { try { l.destroy(); } catch (e) { /* gone */ } });
		tab.lanes = [];
		ctx.clear(box);
		box.classList.add('ts-x-panel');
		tab.shown = id;
		tab.id = id;
		var t = id ? ctx.trackOf(id) : null;
		if (!t) { box.appendChild(h('p', { class: 'ts-muted ts-qmore', text: 'Play something: what goes with it shows up here.' })); return; }
		var seed = ctx.lib().tracks[t.id] ? fromTrack(t, ctx) : seedOf({ kind: 'track', id: t.id }, ctx);
		if (!seed) return;
		var head = h('div', { class: 'ts-x-panel-head' }, [
			h('p', { class: 'ts-context' }, [tab.pinned ? 'Pinned: ' : 'Like ', h('a', { href: hrefOf(seed), text: seed.title })]),
			U.btn({ icon: 'target', label: tab.pinned ? 'Follow the song that is on' : 'Pin to this song', iconOnly: true, size: 'sm', pressed: tab.pinned, on: { click: function () { tab.pinned = !tab.pinned; panel(box, ctx, { id: o.id, force: true }); } } })
		]);
		box.appendChild(head);
		var pill = h('div', { class: 'ts-x-pill', hidden: true });
		tab.pill = pill;
		box.appendChild(pill);
		box.appendChild(U.btn({ icon: 'compass', label: 'Explore it', variant: 'secondary', size: 'sm', href: hrefOf(seed) }));
		if (!Lanes) return;
		order(seed).filter(function (x) { return x !== 'mix'; }).forEach(function (lid) {
			var wrap = h('section', { class: 'ts-x-lane' }), body = h('div');
			wrap.appendChild(body);
			box.appendChild(wrap);
			tab.lanes.push(Lanes.mount(body, ctx, laneSpec(ctx, lid, seed, { compact: true }, { lane: null, scout: null })));
		});
		function offer(next) {
			var nt = ctx.trackOf(next), pill = tab.pill;
			if (!nt || !pill || next === tab.id) return;
			ctx.clear(pill);
			pill.hidden = false;
			pill.appendChild(U.btn({ icon: 'arrow-right', label: 'Now playing changed ' + ctx.words.DOT + ' Show ' + ctx.words.title(nt), variant: 'chip', on: { click: function () { panel(box, ctx, { id: next, force: true }); } } }));
		}
	}

	return {
		parseSeed: parseSeed, seedOf: seedOf, order: order, remember: remember, recall: recall, hrefOf: hrefOf, trail: trail,
		artistSeed: artistSeed, section: section, view: view, panel: panel, LANES: LANES
	};
});
