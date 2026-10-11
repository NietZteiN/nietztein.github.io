/*
 * True Shuffle: channels. A YouTube channel as a place to find music, not only a
 * name under a song: every upload it has, newest first, the artist read from each
 * title, which of them you have, and the channels that find music for you (a
 * channel that uploads other artists' songs, such as a niche reupload channel).
 *
 *     Ch.rank(tracks) -> [{ id, name, songs, artists, names, curator, ids, lastAdded }]
 *     Ch.isMusic(title, durationSec, hasArtist) -> bool
 *     Ch.uploadFinds(items, { channelId, channel, rule, have, find }) -> [find]
 *     Ch.artistsOf(finds) -> [{ key, name, count }]
 *     Ch.teachRule(tracks) -> 'artist-title' | 'title-artist' | null
 *     Ch.demoUploads(channelId, name, rand) -> [{ videoId, title, channel, channelId, addedAt }]
 *     Ch.readList(box, listId, opts) -> Promise<[videoIds]>   (a visible YouTube player)
 *     Ch.view(view, ctx, parts, query)       #/channel/<id> and #/channels
 *     Ch.homeShelf(view, ctx)                the home page's "Channels that find music for you"
 *     Ch.nowLink(track, ctx) -> node | null  under the song that is on, when its channel is one
 *
 * A channel's uploads: with a sign-in or an API key, the Data API (sources.js
 * ytLists: 1 unit for 50, as far back as asked, kept 6 hours); without, a visible
 * YouTube player cues the uploads list and reads its ids (documented calls, at most
 * 200: see README, "What was found about YouTube lists"), and oEmbed gives the
 * titles (free, kept 30 days). The demo invents its uploads.
 *
 * UMD: window.TrueShuffle.channel in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.channel = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var YT_ID = /^[A-Za-z0-9_-]{11}$/, UC = /^UC[A-Za-z0-9_-]{22}$/;
	var NOCOOKIE = 'https://www.youtube-nocookie.com';
	var PAGE = 60;      // rows drawn at a time
	var READ = 100;     // uploads read at a time through the Data API (2 units)
	var HUE = { h: 12, s: 50 };

	function mod(name) { return root.TrueShuffle && root.TrueShuffle[name]; }
	function parser() { return mod('parse') || (typeof require === 'function' ? require('./parse.js') : null); }
	function fold(s) { var P = parser(); return P ? P.fold(String(s || '')) : String(s || '').toLowerCase(); }
	function list(x) { return Array.isArray(x) ? x : x ? Object.keys(x).map(function (k) { return x[k]; }) : []; }

	// ---- The library's channels ----------------------------------------------------------------------

	// The channel is the artist's own: a Topic or VEVO channel, or one named after a
	// singer of its songs ("Neon Abacus Official", "Marrow & Pine").
	var CHANNEL_WORDS = /\b(official|music|channel|youtube|tv|vevo|records?|band|jp|japan)\b/g;
	function ownChannel(name, artists) {
		name = String(name || '');
		if (/\s-\sTopic$/i.test(name) || /VEVO$/i.test(name)) return true;
		var full = fold(name), base = fold(name.toLowerCase().replace(CHANNEL_WORDS, ' '));
		return artists.some(function (a) {
			var k = fold(a);
			if (!k) return false;
			if (k === full || k === base) return true;
			return Math.min(k.length, base.length) >= 4 && (full.indexOf(k) >= 0 || (base && k.indexOf(base) >= 0));
		});
	}
	// The artist a song is by, or the one its title suggests when nothing vouches for one.
	function artistOf(t) { return (t && (t.artist || (t.guess && t.guess.artist))) || ''; }
	function addedOf(t, last) {
		var a = t && t.addedAt, out = '';
		if (a && typeof a === 'object') Object.keys(a).forEach(function (k) { var v = String(a[k] || ''); if (v && (!out || (last ? v > out : v < out))) out = v; });
		else if (a) out = String(a);
		return out;
	}

	// Every channel the tracks came from. A curator is a channel that is not an
	// artist's own and has two songs or more: they come first, the ones with the
	// most artists first; the others by their number of songs.
	function rank(tracks) {
		var by = {};
		list(tracks).forEach(function (t) {
			if (!t || !t.channelId) return;
			var c = by[t.channelId] || (by[t.channelId] = { id: t.channelId, name: t.channel || '', songs: 0, ids: [], arts: {}, lastAdded: '' });
			c.songs++;
			c.ids.push(t.id);
			var a = artistOf(t), k = fold(a);
			if (k) { var e = c.arts[k] || (c.arts[k] = { name: a, n: 0 }); e.n++; }
			var la = addedOf(t, true);
			if (la > c.lastAdded) c.lastAdded = la;
		});
		return Object.keys(by).map(function (key) {
			var c = by[key], self = fold(c.name);
			var own = ownChannel(c.name, Object.keys(c.arts).map(function (k) { return c.arts[k].name; }));
			var keys = Object.keys(c.arts).filter(function (k) { return k !== self; }).sort(function (x, y) { return c.arts[y].n - c.arts[x].n || (x < y ? -1 : 1); });
			return { id: c.id, name: c.name, songs: c.songs, artists: keys.length, names: keys.slice(0, 3).map(function (k) { return c.arts[k].name; }), curator: !own && c.songs >= 2, ids: c.ids, lastAdded: c.lastAdded };
		}).sort(function (x, y) {
			return (y.curator - x.curator) || (x.curator ? y.artists - x.artists : 0) || (y.songs - x.songs) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
		});
	}

	// An upload that is not a song: a short, a trailer, a stream, a vlog, or (when the
	// caller says no artist was read from it) a title of hashtags with no artist in it,
	// which is how Shorts and announcements are titled. Kept apart (shown on request),
	// never played by Play or Shuffle.
	var NOT_MUSIC = /#shorts?\b|\b(trailer|teaser|announcement|livestream|live stream|stream archive|q ?& ?a|vlog|unboxing|reaction|behind the scenes|making of|interview|podcast|tutorial|giveaway|channel update)\b/i;
	var HASHTAG = /(^|\s)#[^\s#]+/;
	function isMusic(title, sec, hasArtist) {
		title = String(title || '');
		if (NOT_MUSIC.test(title)) return false;
		if (hasArtist === false && HASHTAG.test(title)) return false;
		return !(sec > 0 && sec < 45);
	}

	// Uploads (Data API items, read ids with oEmbed titles) as finds: the artist and
	// title read by parse.js (with the channel's rule when one is set: then the artist
	// is sure; `shape` is the parser's rule), `mine` when the library has the video,
	// `music` when it is a song.
	function uploadFinds(items, o) {
		o = o || {};
		var P = parser(), have = o.have || function () { return false; }, make = o.find || function (f) { return f; };
		var rule = typeof o.rule === 'string' || (o.rule && o.rule.artist) ? o.rule : null;
		var out = [], seen = {};
		(items || []).forEach(function (it) {
			var id = it && it.videoId;
			if (!id || seen[id] || it.unavailable) return;
			seen[id] = true;
			var raw = String(it.raw || it.title || ''), ch = it.channel || o.channel || '';
			var p = raw && P ? P.parse(raw, ch, rule ? { channelRule: rule } : undefined) : null;
			out.push(make({
				key: 'v:' + id, videoId: id, title: (p && (p.title || p.whole)) || raw, artist: (p && p.artist) || '',
				channel: ch, channelId: it.channelId || o.channelId || '', source: 'ytuploads', addedAt: it.addedAt || null,
				raw: raw, sure: !!(p && p.vouched), shape: (p && p.rule) || '', version: (p && p.version) || '', music: isMusic(raw, it.durationSec, !!(p && p.artist)), mine: !!have(id),
				why: [['channel', ch]]
			}));
		});
		return out;
	}

	// The artists of some finds, the most frequent first; each under its commonest spelling.
	function artistsOf(finds) {
		var by = {};
		(finds || []).forEach(function (f) {
			var a = f && f.artist, k = fold(a);
			if (!k) return;
			var e = by[k] || (by[k] = { key: k, count: 0, spell: {} });
			e.count++;
			e.spell[a] = (e.spell[a] || 0) + 1;
		});
		return Object.keys(by).map(function (k) {
			var e = by[k], names = Object.keys(e.spell).sort(function (x, y) { return e.spell[y] - e.spell[x] || (x < y ? -1 : 1); });
			return { key: k, name: names[0], count: e.count };
		}).sort(function (x, y) { return y.count - x.count || (x.name < y.name ? -1 : 1); });
	}

	// The rule that would give a channel's songs their artists, when its titles keep
	// one shape and nothing vouches for the artists yet: two songs or uploads or more,
	// and at least 60% of the unsure ones in that shape. Takes library tracks (their
	// guess) and uploads (uploadFinds: an unsure artist and its shape) alike.
	function teachRule(items) {
		var n = { 'artist-title': 0, 'title-artist': 0 }, total = 0;
		list(items).forEach(function (x) {
			if (!x) return;
			var r;
			if (x.guess) { if (x.artist || !x.guess.artist) return; r = x.guess.rule; }
			else { if (x.sure || x.mine || !x.artist) return; r = x.shape; }
			total++;
			if (r === 'dash' || r === 'dash-guess') n['artist-title']++;
			else if (r === 'slash-guess' || r === 'slash') n['title-artist']++;
		});
		var best = n['artist-title'] >= n['title-artist'] ? 'artist-title' : 'title-artist';
		return n[best] >= 2 && n[best] >= total * 0.6 ? best : null;
	}

	// ---- The demo's invented uploads -------------------------------------------------------------------

	var DEMO_ARTISTS = ['Moth Radio', 'Lantern Choir', 'Velvet Kites', 'Copper Sea', 'Static Orchard', 'Paper Comets', 'Glass Orchard', 'Neon Abacus', 'Hollow Compass', 'Mizuiro Parade'];
	var DEMO_WORDS = ['Blue', 'Late', 'Paper', 'Silver', 'Quiet', 'Salt', 'Night', 'Harbor', 'Signal', 'Weather', 'Garden', 'Ferry', 'Lantern', 'Static', 'Engine', 'Window', 'Satellite', 'Echo'];
	function hash36(s) {
		var x = 0x811c9dc5;
		for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
		return ('00000000' + x.toString(36)).slice(-8);
	}
	// Eighteen uploads by several artists, a week or two apart, the newest first;
	// ids of eleven characters, as YouTube's are.
	function demoUploads(channelId, name, rand) {
		rand = rand || Math.random;
		var out = [], day = Date.UTC(2026, 8, 30);
		for (var i = 0; i < 18; i++) {
			var a = DEMO_ARTISTS[Math.floor(rand() * DEMO_ARTISTS.length)];
			var t = DEMO_WORDS[Math.floor(rand() * DEMO_WORDS.length)] + ' ' + DEMO_WORDS[Math.floor(rand() * DEMO_WORDS.length)];
			day -= (6 + Math.floor(rand() * 9)) * 86400000;
			out.push({ videoId: 'dmu' + hash36(channelId + ':' + i), title: a + ' - ' + t + (i % 7 === 3 ? ' (Official Audio)' : ''), channel: name, channelId: channelId, addedAt: new Date(day).toISOString() });
		}
		return out;
	}

	// ---- Reading a list through a visible YouTube player ----------------------------------------------

	// The ids of a YouTube list (an uploads list "UU...", a playlist), read by a player
	// built in `box`: visible, 356 by 200, YouTube's own controls, cued and never
	// played (a press on its play is undone: it only reads). When the item it cues
	// cannot be embedded, the list reads empty without an error; it is cued again
	// from the next item, `retries` (3) times. The player is gone when it settles.
	// opts: { loadApi(timeoutMs) -> Promise<YT>, host, width, height, timeoutMs (20 s),
	// pollMs (150), retryMs (2,500), retries, doc } -> Promise<[ids]> ([] for none)
	function readList(box, listId, o) {
		o = o || {};
		var doc = o.doc || root.document, P = mod('player');
		var load = o.loadApi || (P && P.loadIframeApi);
		var pollMs = o.pollMs || 150, retryMs = o.retryMs || 2500, retries = o.retries == null ? 3 : o.retries, limitMs = o.timeoutMs || 20000;
		if (!load || !doc || !box) return Promise.reject(new Error('The YouTube player is not available here.'));
		return load(o.apiTimeoutMs || 15000).then(function (YT) {
			return new Promise(function (resolve, reject) {
				var slot = doc.createElement('div'), player = null, done = false, tries = 0, since = 0, poll = null, give = null;
				box.appendChild(slot);
				function finish(ids, err) {
					if (done) return;
					done = true;
					clearTimeout(poll);
					clearTimeout(give);
					try { if (player && player.destroy) player.destroy(); } catch (e) { /* already gone */ }
					if (slot.parentNode) slot.parentNode.removeChild(slot);
					if (err) reject(err); else resolve(ids);
				}
				function check() {
					if (done) return;
					var ids = null;
					try { ids = player.getPlaylist(); } catch (e) { ids = null; }
					if (ids && ids.length) { finish(ids.filter(function (id) { return YT_ID.test(String(id)); })); return; }
					if (Date.now() - since > retryMs) {
						if (tries >= retries) { finish([]); return; }
						tries++;
						since = Date.now();
						try { player.cuePlaylist({ listType: 'playlist', list: listId, index: tries }); } catch (e) { finish(null, e); return; }
					}
					poll = setTimeout(check, pollMs);
				}
				give = setTimeout(function () { finish(null, new Error('YouTube did not answer in time.')); }, limitMs);
				player = new YT.Player(slot, {
					host: o.host || NOCOOKIE, width: o.width || 356, height: o.height || 200,
					playerVars: { listType: 'playlist', list: listId, playsinline: 1, rel: 0, origin: root.location ? root.location.origin : undefined },
					events: {
						onReady: function () { since = Date.now(); check(); },
						onStateChange: function (e) { if (e && e.data === 1) { try { player.pauseVideo(); } catch (x) { /* gone */ } } }
					}
				});
			});
		});
	}

	// ---- The pages --------------------------------------------------------------------------------------

	var css = false;
	function injectCss() {
		if (css || !root.document) return;
		css = true;
		var st = root.document.createElement('style');
		st.id = 'ts-channel-css';
		st.textContent = [
			'.ts-ch-tools{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:4px 0 10px;max-width:980px}',
			'.ts-ch-show{display:flex;flex-wrap:wrap;gap:6px}',
			'.ts-ch-filter{flex:1 1 180px;max-width:320px}',
			'.ts-ch-artists{margin:0 0 10px;max-width:980px}',
			'.ts-ch-artists .ts-btn--chip{max-width:100%}',
			'.ts-ch-list{list-style:none;margin:0;padding:0;max-width:980px}',
			'.ts-ch-row{display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:10px}',
			'.ts-ch-row:hover{background:var(--ts-hover)}',
			'.ts-ch-main{flex:1;min-width:0;display:flex;align-items:center;gap:12px;border:0;background:none;color:inherit;font:inherit;text-align:left;padding:6px 4px;cursor:pointer;border-radius:8px}',
			'.ts-ch-main:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
			'.ts-ch-row .ts-q-art{width:64px;height:36px;border-radius:5px;flex:none}',
			'.ts-ch-row .ts-q-text{flex:1;min-width:0}',
			'.ts-ch-row .ts-badge{flex:none}',
			'.ts-ch-row.is-pending .ts-q-title{color:var(--text-2)}',
			'.ts-ch-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0 24px;max-width:980px}',
			'.ts-ch-foot .ts-muted{margin:0;max-width:70ch}',
			'.ts-ch-scout{margin:6px 0 14px;max-width:980px}',
			'.ts-ch-scout iframe{display:block;width:356px;height:200px;max-width:100%;border:0;border-radius:10px;background:#000}',
			'.ts-ch-scout p{margin:0 0 8px}',
			'.ts-ch-teach{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);margin:6px 0 14px;max-width:980px}',
			'.ts-ch-teach p{margin:0;flex:1 1 280px}',
			'.ts-ch-skel{height:48px;border-radius:10px;margin:4px 0;background:var(--ts-hover);opacity:.6}',
			'.ts-now-ch{display:inline-flex;align-items:center;gap:6px;max-width:100%;font-size:13px;color:var(--text-2);text-decoration:none;margin:2px 0 4px}',
			'.ts-now-ch:hover{color:var(--text);text-decoration:underline}',
			'.ts-now-ch b{font-weight:650;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.ts-now-ch .ts-i{width:16px;height:16px;flex:none}',
			'.ts-chs-list{list-style:none;margin:0 0 24px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 16px;max-width:980px}',
			'.ts-chs-list a{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;color:inherit;text-decoration:none}',
			'.ts-chs-list a:hover{background:var(--ts-hover)}',
			'.ts-chs-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'@media (max-width:760px){.ts-ch-row .ts-q-art{width:56px;height:32px}.ts-ch-filter{max-width:none}}'
		].join('\n');
		root.document.head.appendChild(st);
	}

	var memo = {};          // channel id -> { items, via, more, name }: this session's reads
	var http = null;
	function httpFor(ctx) {
		var Src = mod('sources');
		if (!http && Src) http = Src.createHttp({ hosts: Src.endpointsFor(ctx.endpoints ? ctx.endpoints() : null) });
		return http;
	}
	function relDate(iso, now) {
		var t = Date.parse(iso || '');
		if (!t) return '';
		var d = Math.floor((now - t) / 86400000);
		if (d < 1) return 'today';
		if (d < 2) return 'yesterday';
		if (d < 14) return d + ' days ago';
		if (d < 60) return Math.round(d / 7) + ' weeks ago';
		if (d < 730) return Math.round(d / 30.4) + ' months ago';
		return Math.round(d / 365) + ' years ago';
	}
	// Fisher-Yates with shuffle.js's crypto source (S.trueShuffle takes tracks or ids, not any value).
	function shuffled(arr, ctx) {
		var S = ctx.S, rand = S && S.cryptoRng ? S.cryptoRng() : null, out = arr.slice();
		for (var i = out.length - 1; i > 0; i--) { var j = rand && rand.int ? rand.int(i + 1) : Math.floor(Math.random() * (i + 1)); var x = out[i]; out[i] = out[j]; out[j] = x; }
		return out;
	}
	// A find the engine can take (sources.js find shape). An upload keeps its title as
	// uploaded: the registry reads it like an import, with the channel's rule if any.
	function toFind(f) {
		var Src = mod('sources'), x = { key: f.key, videoId: f.videoId, title: f.mine ? f.title : (f.raw || f.title), artist: f.artist, channel: f.channel, channelId: f.channelId, source: f.mine ? 'library' : 'ytuploads', why: f.why || [] };
		return Src && Src.find ? Src.find(x) : x;
	}

	// #/channel/<id>
	function viewChannel(el, ctx, id, query) {
		var h = ctx.h, U = ctx.U, W = ctx.words, L = ctx.L, lib = ctx.lib();
		var mine = L.list(lib).filter(function (t) { return t.channelId === id; });
		var info = rank(mine)[0] || null;
		var name = mine.length ? mine[0].channel : (memo[id] && memo[id].name) || 'Channel';
		var href = ctx.link('channel', id), here = root.location ? root.location.hash : '';
		var readable = ctx.demo || UC.test(id);
		var st = { show: query && query.get ? query.get('show') || '' : '', artist: '', q: '', shown: PAGE, finds: null, via: '', more: false, others: false, error: null, busy: false };

		var playNewBtn = U.btn({ icon: 'play', label: 'Play what\'s new to you', variant: 'primary', size: 'lg', disabled: true, on: { click: playNew } });
		var shuffleBtn = U.btn({ icon: 'shuffle', label: 'Shuffle the channel', variant: 'secondary', size: 'md', disabled: !mine.length, on: { click: shuffleAll } });
		var head = ctx.ui.headerBlock(el, {
			kicker: info && info.curator ? 'A channel that finds music for you' : 'YouTube channel', title: name, hue: HUE,
			artNode: mine[0] ? ctx.art(mine[0], 'ts-hero-art') : null, meta: ' ',
			actions: [playNewBtn, shuffleBtn, UC.test(id) ? ctx.ui.smallBtn('external', 'Open on YouTube', function () { root.open('https://www.youtube.com/channel/' + encodeURIComponent(id), '_blank', 'noopener'); }) : null]
		});
		var metaEl = head.querySelector('.ts-hero-meta');

		// a note when the artists here are only guessed and the titles keep one shape (drawn by draw())
		var teachBox = h('div');
		el.appendChild(teachBox);

		var tools = h('div', { class: 'ts-ch-tools' });
		var showRow = h('div', { class: 'ts-ch-show', role: 'group', aria: { label: 'Which uploads' } });
		var filter = h('input', { class: 'kit-input ts-ch-filter', type: 'search', placeholder: 'Filter by title or artist', aria: { label: 'Filter the uploads by title or artist' } });
		filter.addEventListener('input', function () { st.q = filter.value; st.shown = PAGE; draw(); });
		tools.appendChild(showRow);
		tools.appendChild(filter);
		el.appendChild(tools);
		var artistsRow = h('div', { class: 'ts-chips ts-ch-artists', role: 'group', aria: { label: 'Artists on this channel' } });
		el.appendChild(artistsRow);
		var scoutBox = h('div', { class: 'ts-ch-scout', hidden: true });
		el.appendChild(scoutBox);
		var listEl = h('ol', { class: 'ts-ch-list', aria: { label: 'Uploads', busy: 'false' } });
		el.appendChild(listEl);
		var foot = h('div', { class: 'ts-ch-foot' });
		el.appendChild(foot);
		if (ctx.extras && ctx.extras.channel) ctx.extras.channel(el, id, mine);

		function gone() { return !!(root.location && root.location.hash !== here) || !el.isConnected; }
		function have(v) { return !!lib.tracks[v]; }
		// the library's songs from the channel as rows (the library's titles and artists)
		function mineRow(t, addedAt) { return { key: 'v:' + t.id, videoId: t.id, title: W.title(t), artist: W.artist(t), channel: t.channel, channelId: id, addedAt: addedAt || addedOf(t, false), mine: true, sure: true, music: true, why: [['channel', name]] }; }
		// every row: the uploads read (yours shown as the library has them), then your songs older than those
		function rows() {
			var out = [], seen = {};
			(st.finds || []).forEach(function (f) { seen[f.videoId] = true; out.push(f.mine && lib.tracks[f.videoId] ? mineRow(lib.tracks[f.videoId], f.addedAt) : f); });
			mine.forEach(function (t) { if (!seen[t.id]) out.push(mineRow(t)); });
			return out;
		}
		function take(m) {
			var r = lib.channelRules && lib.channelRules[id];
			st.finds = uploadFinds(m.items, { channelId: id, channel: name, rule: r, have: have });
			st.via = m.via;
			st.more = !!m.more;
			st.error = null;
			st.busy = false;
			draw();
		}
		function failed(e) { st.busy = false; st.error = (e && e.message) || 'The uploads could not be read.'; draw(); }

		function read(more) {
			if (!readable) { st.error = 'This channel cannot be listed.'; draw(); return; }
			var m = memo[id];
			if (!more && m) { take(m); return; }
			if (ctx.demo) {
				memo[id] = { items: demoUploads(id, name, ctx.S.rng('channel-' + id)), via: 'demo', more: false, name: name };
				take(memo[id]);
				return;
			}
			var Src = mod('sources');
			if (ctx.canRead && ctx.canRead() && Src && ctx.client && ctx.client()) {
				var max = more && m ? m.items.length + READ : READ;
				st.busy = true;
				draw();
				Src.ytLists(ctx.client(), ctx.cache()).uploads(id, { max: max }).then(function (items) {
					memo[id] = { items: items, via: 'api', more: items.length >= max, name: name };
					if (!gone()) take(memo[id]);
				}, function (e) { if (!gone()) failed(e); });
				return;
			}
			scout();
		}
		// signed out without a key: a visible player reads the uploads list, oEmbed the titles
		function scout() {
			st.busy = true;
			draw();
			ctx.clear(scoutBox);
			scoutBox.hidden = false;
			scoutBox.appendChild(h('p', { class: 'ts-muted', text: 'Reading this channel\'s uploads through YouTube\'s player' + W.ELL }));
			readList(scoutBox, 'UU' + id.slice(2), {}).then(function (ids) {
				scoutBox.hidden = true;
				ctx.clear(scoutBox);
				var items = ids.map(function (v) { return { videoId: v, title: '', channel: name, channelId: id }; });
				memo[id] = { items: items, via: 'scout', more: false, name: name };
				if (gone()) return;
				take(memo[id]);
				titles(memo[id]);
			}, function (e) { scoutBox.hidden = true; ctx.clear(scoutBox); if (!gone()) failed(e); });
		}
		function titles(m) {
			var Src = mod('sources');
			if (!Src) return;
			var oe = Src.oEmbed(httpFor(ctx), ctx.cache()), by = {}, need = [];
			m.items.forEach(function (it) { by[it.videoId] = it; if (!it.title) need.push(it.videoId); });
			(function next(k) {
				if (k >= need.length || gone()) return;
				oe.videos(need.slice(k, k + 20)).then(function (answers) {
					answers.forEach(function (a) { var it = by[a.id]; if (!it) return; if (a.ok) { it.title = a.title; if (a.channel) it.channel = a.channel; } else it.unavailable = true; });
					if (!gone()) take(m);
					next(k + 20);
				}, function () { next(k + 20); });
			})(0);
		}

		function playNew() {
			var en = ctx.engine(), fresh = rows().filter(function (f) { return !f.mine && f.music && f.title; });
			if (!fresh.length) { ctx.say('You have every song here.'); return; }
			if (!en) { ctx.say('Playing new songs needs the discovery engine.'); return; }
			en.list(fresh.map(toFind), { label: name + ': new to you', href: href, searchCap: 0 });
		}
		function shuffleAll() {
			var en = ctx.engine(), pool = shuffled(rows().filter(function (f) { return f.music && (f.mine || f.title); }), ctx);
			if (!pool.length) return;
			if (!en || !st.finds) { ctx.play.from(pool.filter(function (f) { return f.mine; }).map(function (f) { return f.videoId; }), 0, { label: name, href: href }); return; }
			en.list(pool.map(toFind), { label: name, href: href, searchCap: 0 });
		}
		function play(f, mode) {
			if (f.mine) { var ids = [f.videoId]; if (mode === 'next') ctx.play.next(ids); else if (mode === 'later') ctx.play.later(ids); else ctx.play.now(ids, { label: name, href: href }); return; }
			ctx.play.find(toFind(f), mode);
		}
		function menu(at, f) {
			var en = ctx.engine(), A = ctx.A, saved = en && en.isSaved ? en.isSaved(f.key) : false;
			ctx.U.openMenu(at, [
				A.item('play', function () { play(f, 'now'); }),
				A.item('play-next', function () { play(f, 'next'); }),
				A.item('add-to-queue', function () { play(f, 'later'); }),
				!f.mine && en ? (saved ? A.item('unsave', function () { en.unsave(f.key); draw(); }) : A.item('save', function () { en.save(toFind(f)); draw(); })) : null,
				f.mine ? A.item('details', function () { ctx.nav(ctx.link('track', f.videoId)); }) : null,
				A.item('open-youtube', function () { root.open('https://www.youtube.com/watch?v=' + encodeURIComponent(f.videoId), '_blank', 'noopener'); })
			].filter(Boolean), { label: f.title || 'This video', returnTo: at });
		}
		function sub(f) {
			var bits = [];
			if (f.artist) bits.push(f.artist);
			var d = relDate(f.addedAt, ctx.now());
			if (d) bits.push(d);
			return bits.join(' ' + W.DOT + ' ');
		}
		function row(f) {
			var t = f.mine ? lib.tracks[f.videoId] : null, pending = !f.title;
			var li = h('li', { class: 'ts-ch-row' + (f.mine ? ' is-mine' : '') + (pending ? ' is-pending' : ''), data: { id: f.videoId } });
			var art = t ? ctx.art(t, 'ts-q-art') : U.art(f.videoId, HUE.h, f.title || name, 'ts-q-art', !ctx.demo && ctx.prefs().art !== false, 40);
			li.appendChild(h('button', { class: 'ts-ch-main', title: 'Play now', on: { click: function () { play(f, 'now'); } } }, [art, h('span', { class: 'ts-q-text' }, [
				h('span', { class: 'ts-q-title', text: f.title || 'Loading the title' + W.ELL }),
				h('span', { class: 'ts-q-artist', text: sub(f) })
			])]));
			if (f.mine) li.appendChild(U.badge('library', 'Yours'));
			li.appendChild(U.btn({ icon: 'queue-next', label: 'Play ' + (f.title || 'it') + ' next', iconOnly: true, size: 'sm', on: { click: function () { play(f, 'next'); } } }));
			li.appendChild(U.btn({ icon: 'more', label: 'More for ' + (f.title || 'this video'), iconOnly: true, size: 'sm', menu: true, on: { click: function (e) { menu(e.currentTarget, f); } } }));
			return li;
		}

		function drawTeach() {
			ctx.clear(teachBox);
			var rule = teachRule(mine.concat(st.finds || []));
			if (!rule || (lib.channelRules && lib.channelRules[id]) || !ctx.channelRule) return;
			var unsure = mine.filter(function (t) { return !t.artist && t.guess && t.guess.artist; }).length, shape = rule === 'artist-title' ? 'Artist - Title' : 'Title / Artist';
			teachBox.appendChild(h('div', { class: 'ts-ch-teach' }, [
				h('p', { text: (unsure ? 'The artists of your ' + W.plural(unsure, 'song') + ' from this channel are only guessed. ' : 'The artists of these uploads are only guessed. ') + 'Its titles read "' + shape + '": the artists can come from them, for your songs and its uploads.' }),
				U.btn({ icon: 'check', label: 'Take the artists from the titles', variant: 'secondary', size: 'sm', on: { click: function () { var ids = ctx.channelRule(id, rule); ctx.say(ids.length ? W.plural(ids.length, 'song') + ' read again with the artist from the title.' : 'Songs from this channel will take their artist from the title.'); ctx.redraw(); } } })
			]));
		}
		function draw() {
			drawTeach();
			var all = rows(), music = all.filter(function (f) { return f.music !== false; }), notMusic = all.length - music.length;
			var fresh = music.filter(function (f) { return !f.mine; }), yours = all.filter(function (f) { return f.mine; });
			var show = st.show || (st.finds ? (fresh.length ? 'new' : 'all') : 'yours');
			// which uploads
			ctx.clear(showRow);
			[['new', 'New to you', fresh.length], ['yours', 'Yours', yours.length], ['all', 'All', st.others ? all.length : music.length]].forEach(function (c) {
				showRow.appendChild(U.btn({ variant: 'chip', label: c[1] + ' ' + c[2], pressed: show === c[0], on: { click: function () { st.show = c[0]; st.artist = ''; st.shown = PAGE; draw(); } } }));
			});
			var base = show === 'new' ? fresh : show === 'yours' ? yours : (st.others ? all : music);
			// the artists here
			var arts = artistsOf(base);
			ctx.clear(artistsRow);
			if (arts.length > 1) {
				arts.slice(0, 12).forEach(function (a) {
					artistsRow.appendChild(U.btn({ variant: 'chip', label: a.name + ' ' + a.count, pressed: st.artist === a.key, on: { click: function () { st.artist = st.artist === a.key ? '' : a.key; st.shown = PAGE; draw(); } } }));
				});
			}
			var q = fold(st.q);
			var shown = base.filter(function (f) { return (!st.artist || fold(f.artist) === st.artist) && (!q || fold(f.title + ' ' + f.artist).indexOf(q) >= 0); });
			ctx.clear(listEl);
			listEl.setAttribute('aria-busy', st.busy ? 'true' : 'false');
			shown.slice(0, st.shown).forEach(function (f) { listEl.appendChild(row(f)); });
			if (st.busy && !st.finds) for (var k = 0; k < 4; k++) listEl.appendChild(h('li', { class: 'ts-ch-skel', aria: { hidden: 'true' } }));
			// under the list
			ctx.clear(foot);
			if (!shown.length && !st.busy) foot.appendChild(h('p', { class: 'ts-muted', text: st.finds ? (show === 'new' && !st.q && !st.artist ? 'You have every song this channel has uploaded' + (st.via === 'scout' && (st.finds || []).length >= 200 ? ' among its newest 200' : '') + '.' : 'Nothing here matches.') : st.error ? '' : 'Nothing yet.' }));
			if (shown.length > st.shown) foot.appendChild(U.btn({ icon: 'down', label: 'Show ' + Math.min(PAGE, shown.length - st.shown) + ' more', variant: 'secondary', size: 'sm', on: { click: function () { st.shown += PAGE; draw(); } } }));
			if (st.via === 'api' && st.more) foot.appendChild(U.btn({ icon: 'down', label: 'Load older uploads', variant: 'secondary', size: 'sm', cost: 2, busy: st.busy, on: { click: function () { read(true); } } }));
			if (notMusic && !st.others) foot.appendChild(U.btn({ label: 'Show ' + W.plural(notMusic, 'other upload') + ' (trailers, shorts, streams)', variant: 'ghost', size: 'sm', on: { click: function () { st.others = true; draw(); } } }));
			if (st.via === 'scout' && (st.finds || []).length >= 200) foot.appendChild(h('p', { class: 'ts-muted', text: 'Without a sign-in YouTube lets a page read a channel\'s newest 200 uploads. Sign in, or add an API key in Settings, to read further back.' }));
			if (st.error) {
				foot.appendChild(h('p', { class: 'ts-muted', text: st.error }));
				if (readable) foot.appendChild(U.btn({ icon: 'retry', label: 'Try again', variant: 'secondary', size: 'sm', on: { click: function () { delete memo[id]; st.error = null; read(false); } } }));
			}
			// the header follows
			if (metaEl) metaEl.textContent = [W.plural(yours.length, 'song') + ' in your library', st.finds ? W.plural(st.finds.length, 'upload') + (st.via === 'scout' && st.finds.length >= 200 ? ' (the newest)' : '') : '', artistsOf(music).length > 1 ? W.plural(artistsOf(music).length, 'artist') : ''].filter(Boolean).join(' ' + W.DOT + ' ');
			U.btnState(playNewBtn, { disabled: !fresh.some(function (f) { return f.title; }), label: fresh.length ? 'Play what\'s new to you' : 'Nothing new to you' });
			U.btnState(shuffleBtn, { disabled: !music.length });
		}

		draw();
		read(false);
	}

	function cardOf(ctx, c) {
		var W = ctx.words, t = ctx.lib().tracks[c.ids[0]];
		var sub = W.plural(c.songs, 'song') + (c.artists > 1 ? ' ' + W.DOT + ' ' + W.plural(c.artists, 'artist') : c.names[0] ? ' ' + W.DOT + ' ' + c.names[0] : '');
		return ctx.ui.card({
			href: ctx.link('channel', c.id), art: t ? ctx.art(t) : ctx.U.swatch(HUE.h, c.name, '', HUE.s), title: c.name, sub: sub,
			play: function () { ctx.play.from(shuffled(c.ids.slice(), ctx), 0, { label: c.name, href: ctx.link('channel', c.id) }); }, playLabel: 'Shuffle your songs from ' + c.name
		});
	}

	// #/channels: every channel the library's songs came from, the ones that find music first.
	function viewChannels(el, ctx) {
		var h = ctx.h, W = ctx.words, cs = rank(ctx.L.list(ctx.lib()));
		var cur = cs.filter(function (c) { return c.curator; }), rest = cs.filter(function (c) { return !c.curator; });
		ctx.ui.headerBlock(el, {
			kicker: 'Where your songs were uploaded', title: 'Channels', art: false, hue: HUE,
			blurb: 'Some channels find music for you: they upload songs by other artists. Each one opens with all its uploads, the ones new to you first.',
			meta: W.plural(cs.length, 'channel') + (cur.length ? ' ' + W.DOT + ' ' + cur.length + ' that find music for you' : '')
		});
		if (!cs.length) { el.appendChild(h('p', { class: 'ts-empty', text: 'No channels yet: import some music first.' })); return; }
		if (cur.length) {
			ctx.ui.sectionHead(el, 'Channels that find music for you');
			ctx.ui.grid(el, cur.slice(0, 60).map(function (c) { return cardOf(ctx, c); }), 'is-cards');
		}
		if (rest.length) {
			ctx.ui.sectionHead(el, cur.length ? 'Artists\' own channels' : 'Your channels');
			var ul = h('ul', { class: 'ts-chs-list' });
			rest.slice(0, 200).forEach(function (c) { ul.appendChild(h('li', null, h('a', { href: ctx.link('channel', c.id) }, [h('span', { class: 'ts-chs-name', text: c.name }), h('span', { class: 'ts-muted', text: W.plural(c.songs, 'song') })]))); });
			el.appendChild(ul);
		}
	}

	function view(el, ctx, parts, query) {
		injectCss();
		var r = ctx.route();
		if (r && r.parts && r.parts[0] === 'channels') viewChannels(el, ctx);
		else viewChannel(el, ctx, String((parts && parts[0]) || ''), query);
	}

	// The home page: the channels that find music for you, when there are any.
	function homeShelf(el, ctx) {
		var cs = rank(ctx.L.list(ctx.lib())).filter(function (c) { return c.curator; });
		if (!cs.length) return;
		injectCss();
		ctx.ui.sectionHead(el, 'Channels that find music for you', { href: '#/channels', text: 'All channels' });
		ctx.ui.shelf(el, cs.slice(0, 10).map(function (c) { return cardOf(ctx, c); }));
	}

	// Under the song that is on: its channel, when the channel finds music for you.
	var known = { ix: null, by: null };
	function nowLink(t, ctx) {
		if (!t || !t.channelId) return null;
		var ix = ctx.idx();
		if (known.ix !== ix) { known = { ix: ix, by: {} }; rank(ctx.L.list(ctx.lib())).forEach(function (c) { known.by[c.id] = c; }); }
		var c = known.by[t.channelId];
		if (!c || !c.curator) return null;
		injectCss();
		var h = ctx.h, W = ctx.words;
		var said = 'From ' + c.name + ': ' + (c.artists > 1 ? W.plural(c.artists, 'artist') + ', ' : '') + W.plural(c.songs, 'song') + ' of yours. Every upload of the channel, the ones new to you first';
		return h('a', { class: 'ts-now-ch', href: ctx.link('channel', t.channelId), title: said, aria: { label: said } }, [
			ctx.icon('channel'), h('span', { text: 'From' }), h('b', { text: c.name }),
			h('span', { text: W.DOT + ' ' + (c.artists > 1 ? W.plural(c.artists, 'artist') + ', ' : '') + W.plural(c.songs, 'song') + ' of yours' })
		]);
	}

	return {
		rank: rank, isMusic: isMusic, uploadFinds: uploadFinds, artistsOf: artistsOf, teachRule: teachRule, demoUploads: demoUploads,
		readList: readList, view: view, homeShelf: homeShelf, nowLink: nowLink, PAGE: PAGE, READ: READ
	};
});
