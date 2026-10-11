/*
 * True Shuffle: sharing. A queue or a list of songs as a link anyone can
 * open (#/share?ids=<video ids>&t=<title>), with no sign-in and no library:
 * the titles come from YouTube's oEmbed (free, no key) and the songs play
 * as found songs. A link can also say where to start (&at=<video id>&s=<seconds>:
 * handoff.js's "Continue on your phone"), and the page then offers "Play from 2:31".
 * And a pasted list ("Artist - Title" lines, or YouTube links) turned into
 * songs to play or queue (#/paste).
 *
 *     Sh.link(ids, title, base, { id, sec }) -> 'https://.../#/share?ids=a.b.c&at=b&s=151&t=Title'
 *     Sh.decode(query) -> { ids, title, start: { id, index, sec } | null }
 *     Sh.parseList(text) -> [{ videoId } | { artist, title }]
 *     Sh.seekOnPlay(player, id, sec) -> stop()  (go to that second once the song plays)
 *     Sh.startIn(decoded, playableIds) -> { k, sec, exact } | null   (where "Play from" starts)
 *     Sh.view(view, ctx, parts, query)          (the routes #/share and #/paste)
 *     Sh.configure({ fetch })                   (tests)
 *
 * UMD: window.TrueShuffle.share in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.share = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var MAX = 100;
	var MAX_SEC = 999999;
	var fetchFn = null;

	function configure(o) { if (o && o.fetch) fetchFn = o.fetch; }
	function doFetch(url) { return (fetchFn || root.fetch)(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }); }

	// At most n characters, never half of a character written as two (encodeURIComponent refuses half).
	function clip(s, n) {
		s = String(s).slice(0, n);
		return /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s;
	}
	// A link to these songs (at most 100), with a title, and where to start:
	// start { id, sec } is the song and the second (whole seconds; under one is the beginning).
	function link(ids, title, base, start) {
		var ok = (ids || []).filter(function (id) { return YT_ID.test(id); });
		var seen = {}, list = [];
		ok.forEach(function (id) { if (!seen[id]) { seen[id] = true; list.push(id); } });
		list = list.slice(0, MAX);
		var h = '#/share?ids=' + list.join('.');
		if (start && list.indexOf(start.id) >= 0) {
			var sec = Math.min(MAX_SEC, Math.floor(+start.sec || 0));
			h += '&at=' + start.id + (sec >= 1 ? '&s=' + sec : '');
		}
		if (title) h += '&t=' + encodeURIComponent(clip(title, 120));
		return (base || '') + h;
	}
	// A link that says where to start has `start`; an older one, or a start that is not
	// among its songs, has null. Seconds without a song start the first one.
	function decode(query) {
		function get(k) { return query && query.get ? query.get(k) || '' : ''; }
		var ids = [], seen = {};
		get('ids').split(/[.,\s]+/).forEach(function (id) { if (YT_ID.test(id) && !seen[id]) { seen[id] = true; ids.push(id); } });
		ids = ids.slice(0, MAX);
		var at = get('at'), s = get('s');
		var sec = /^\d{1,6}$/.test(s) ? +s : 0, i = at ? ids.indexOf(at) : 0;
		var start = (at || sec) && i >= 0 && ids.length ? { id: ids[i], index: i, sec: sec } : null;
		return { ids: ids, title: get('t').slice(0, 120), start: start };
	}
	// The controller has no start offset, so the second is reached with a seek once
	// the song plays. Other songs playing first are ignored; after a minute it gives up.
	function seekOnPlay(player, id, sec, ms) {
		var off = null, timer = null;
		function stop() { if (off) { off(); off = null; } if (timer) { clearTimeout(timer); timer = null; } }
		if (!player || !player.on || !(sec >= 1)) return stop;
		off = player.on('playing', function (e) {
			if (!e || e.id !== id) return;
			stop();
			player.seek(sec);
		});
		timer = setTimeout(stop, ms || 60000);
		return stop;
	}
	// A YouTube address or a bare id -> the id, else ''.
	function videoIdOf(s) {
		s = String(s || '').trim();
		if (YT_ID.test(s)) return s;
		var m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(s);
		return m ? m[1] : '';
	}
	// One song a line: a YouTube link, "Artist - Title" (any dash), "Title / Artist",
	// "Title by Artist"; numbering and bullets are dropped.
	function parseList(text) {
		var out = [];
		String(text || '').split(/\r?\n/).forEach(function (line) {
			var l = line.replace(/^\s*(?:\d+[.)]\s*|[-*\u2022]\s+)/, '').trim();
			if (!l) return;
			var vid = videoIdOf(l);
			if (vid) { out.push({ videoId: vid, line: line }); return; }
			var m = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/.exec(l);
			if (m) { out.push({ artist: m[1].trim(), title: m[2].trim(), line: line }); return; }
			m = /^(.+?)\s*[\/\uFF0F]\s*(.+)$/.exec(l);
			if (m) { out.push({ artist: m[2].trim(), title: m[1].trim(), line: line }); return; }
			m = /^(.+?)\s+by\s+(.+)$/i.exec(l);
			if (m) { out.push({ artist: m[2].trim(), title: m[1].trim(), line: line }); return; }
			out.push({ artist: '', title: l, line: line });
		});
		return out;
	}
	// oEmbed for many ids, four at a time: { id: { title, channel } | null }
	function titles(ids) {
		var out = {}, i = 0;
		function next() {
			if (i >= ids.length) return Promise.resolve();
			var id = ids[i++];
			return doFetch('https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json').then(function (r) {
				return r && r.ok ? r.json() : null;
			}).then(function (j) { out[id] = j && j.title ? { title: String(j.title), channel: String(j.author_name || '') } : null; }, function () { out[id] = null; }).then(next);
		}
		var lanes = [];
		for (var k = 0; k < Math.min(4, ids.length); k++) lanes.push(next());
		return Promise.all(lanes).then(function () { return out; });
	}

	// Titles for ids: the library's own first, then oEmbed for the rest (never in the demo, whose songs are invented).
	function known(ctx, ids) {
		var lib = ctx.lib(), out = {}, ask = [];
		ids.forEach(function (id) { var t = lib && lib.tracks[id]; if (t) out[id] = { title: ctx.words.title(t), channel: ctx.words.artist(t) }; else ask.push(id); });
		if (!ask.length || ctx.demo) return Promise.resolve(out);
		return titles(ask).then(function (meta) { ask.forEach(function (id) { out[id] = meta[id]; }); return out; });
	}

	var css = false;
	function addCss(ctx) {
		if (css || !root.document) return;
		css = true;
		var st = root.document.createElement('style');
		st.id = 'ts-share-css';
		st.textContent = '.ts-share-list{list-style:none;margin:8px 0 0;padding:0;max-width:900px}' +
			'.ts-share-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px}' +
			'.ts-share-row:hover{background:var(--ts-hover)}' +
			'.ts-share-row .ts-q-art{width:44px;height:44px;border-radius:5px}' +
			'.ts-share-row .ts-q-text{flex:1;min-width:0}' +
			'.ts-paste{width:100%;min-height:180px;font:inherit;font-size:14px;line-height:1.5;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);resize:vertical}' +
			'.ts-share-note{max-width:70ch}' +
			'.ts-share-start{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;max-width:900px;margin:16px 0 4px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}' +
			'.ts-share-start .ts-q-art{width:64px;height:64px;border-radius:8px;flex:none}' +
			'.ts-share-start-text{flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:2px}' +
			'.ts-share-start-t{font-size:18px;font-weight:700;color:var(--heading);overflow-wrap:anywhere}' +
			'.ts-share-start-a{color:var(--text-2);overflow-wrap:anywhere}' +
			'@media (max-width:760px){.ts-share-start>.ts-btn{flex:1 1 100%}}';
		root.document.head.appendChild(st);
	}

	// A find for a shared or pasted song.
	function findOf(ctx, it, meta) {
		var Src = root.TrueShuffle && root.TrueShuffle.sources;
		var f = it.videoId
			? { key: 'v:' + it.videoId, videoId: it.videoId, title: (meta && meta.title) || it.title || '', artist: it.artist || '', channel: (meta && meta.channel) || '', source: 'shared' }
			: { key: 'paste:' + (it.artist || '').toLowerCase() + '|' + (it.title || '').toLowerCase(), videoId: null, title: it.title || '', artist: it.artist || '', source: 'pasted' };
		return Src && Src.find ? Src.find(f) : f;
	}
	function rowFor(ctx, f, i, all) {
		var h = ctx.h, U = ctx.U;
		var li = h('li', { class: 'ts-share-row' });
		li.appendChild(f.videoId ? U.art(f.videoId, 210, f.title, 'ts-q-art', !ctx.demo) : U.swatch(210, f.title || '?', 'ts-q-art'));
		li.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: f.title || 'A song' }), h('span', { class: 'ts-q-artist', text: f.artist || f.channel || '' })]));
		var pb = U.btn({ icon: 'play', label: 'Play', variant: 'primary', size: 'sm', cost: f.videoId ? null : 100 });
		pb.addEventListener('click', function () { ctx.play.find(f, 'now'); });
		li.appendChild(pb);
		var more = U.btn({ icon: 'queue-next', label: 'Play next', iconOnly: true });
		more.addEventListener('click', function () { ctx.play.find(f, 'next'); });
		li.appendChild(more);
		return li;
	}
	function listActions(ctx, finds, label, href) {
		var row = ctx.h('div', { class: 'ts-actions' });
		row.appendChild(ctx.ui.actionBtn('play', 'Play all', function () {
			var en = ctx.engine();
			if (en) en.list(finds, { label: label, href: href, searchCap: 10 }); else ctx.say('Playing found songs needs the discovery engine.');
		}, true));
		row.appendChild(ctx.ui.actionBtn('queue-add', 'Add all to the queue', function () {
			var ready = finds.filter(function (f) { return f.videoId; });
			ready.forEach(function (f) { ctx.play.find(f, 'later'); });
			if (ready.length < finds.length) ctx.say((finds.length - ready.length) + ' of them still need finding on YouTube: Play all looks them up as it goes.');
		}));
		return row;
	}

	// Where a link's start lands among the songs that can play (kept): its song, or when that
	// one is gone the next that is not, from the beginning. -> { k, sec, exact } or null
	function startIn(d, kept) {
		if (!d.start) return null;
		for (var j = d.start.index; j < d.ids.length; j++) {
			var k = kept.indexOf(d.ids[j]);
			if (k >= 0) return { k: k, sec: j === d.start.index ? d.start.sec : 0, exact: j === d.start.index };
		}
		return null;
	}
	function playLabel(ctx, sec) { return sec ? 'Play from ' + ctx.words.clock(sec) : 'Play'; }
	// The song a link starts at and one big button, busy until the titles are in.
	function startCard(ctx, sec) {
		var h = ctx.h, U = ctx.U;
		var c = { art: U.swatch(210, '', 'ts-q-art'), title: h('span', { class: 'ts-share-start-t', text: 'Loading' + ctx.words.ELL }), who: h('span', { class: 'ts-share-start-a' }) };
		c.btn = U.btn({ icon: 'play', label: playLabel(ctx, sec), variant: 'primary', size: 'lg', busy: true, busyLabel: 'Loading' + ctx.words.ELL });
		c.node = h('div', { class: 'ts-share-start' }, [c.art, h('span', { class: 'ts-share-start-text' }, [c.title, c.who]), c.btn]);
		return c;
	}
	function fillStart(ctx, c, finds, s, label, href) {
		var f = finds[s.k];
		c.node.replaceChild(ctx.U.art(f.videoId, 210, f.title, 'ts-q-art', !ctx.demo), c.art);
		c.title.textContent = f.title || 'A song';
		c.who.textContent = s.exact ? f.artist || f.channel || '' : 'The song that was on cannot be played here, so the next one starts.';
		ctx.U.btnState(c.btn, { label: playLabel(ctx, s.sec), busy: false });
		c.btn.addEventListener('click', function () {
			var en = ctx.engine();
			if (!en) { ctx.say('Playing found songs needs the discovery engine.'); return; }
			var stop = seekOnPlay(ctx.player(), f.videoId, s.sec);
			en.list(finds.slice(s.k), { label: label, href: href, searchCap: 10 }).then(function (ids) { if (!ids || ids[0] !== f.videoId) stop(); }, stop);
		});
	}

	function viewShare(view, ctx, query) {
		var h = ctx.h, d = decode(query);
		ctx.ui.headerBlock(view, { kicker: d.start ? 'Continue listening' : 'Shared with you', title: d.title || 'Songs to listen to', meta: d.ids.length + ' songs', art: false, hue: { h: 205, s: 50 } });
		if (!d.ids.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'This link has no songs in it.' })); return; }
		view.appendChild(h('p', { class: 'ts-muted ts-share-note', text: 'These play here through YouTube\u2019s own player, with no sign-in. Their titles come from YouTube.' }));
		var card = d.start ? startCard(ctx, d.start.sec) : null;
		if (card) view.appendChild(card.node);
		var box = h('div');
		view.appendChild(box);
		var ul = h('ul', { class: 'ts-share-list', aria: { busy: 'true' } });
		box.appendChild(ul);
		d.ids.forEach(function () { ul.appendChild(h('li', { class: 'ts-share-row' }, [h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title ts-muted', text: 'Loading' + ctx.words.ELL })])])); });
		var here = root.location ? root.location.hash : '', label = d.title || 'Shared songs';
		known(ctx, d.ids).then(function (meta) {
			if (root.location && root.location.hash !== here) return;
			var kept = d.ids.filter(function (id) { return meta[id] !== null; });
			var finds = kept.map(function (id) { return findOf(ctx, { videoId: id }, meta[id]); });
			ctx.clear(ul);
			ul.setAttribute('aria-busy', 'false');
			var s = startIn(d, kept);
			if (s) fillStart(ctx, card, finds, s, label, here);
			else {
				if (card) view.removeChild(card.node);
				box.insertBefore(listActions(ctx, finds, label, here), ul);
			}
			finds.forEach(function (f, i) { ul.appendChild(rowFor(ctx, f, i, finds)); });
			var gone = d.ids.length - finds.length;
			if (gone) box.appendChild(h('p', { class: 'ts-muted', text: gone + (gone === 1 ? ' song is' : ' songs are') + ' no longer on YouTube or cannot be played on other sites.' }));
		});
	}

	function viewPaste(view, ctx) {
		var h = ctx.h;
		ctx.ui.headerBlock(view, { kicker: 'Songs from anywhere', title: 'Paste a list', blurb: 'One song a line: "Artist - Title", "Title / Artist", or a YouTube link. From a chat, a forum post, a tracklist.', art: false, hue: { h: 160, s: 45 } });
		var ta = h('textarea', { class: 'ts-paste', aria: { label: 'The list of songs' }, placeholder: 'Lia - Toki wo Kizamu Uta\nhttps://www.youtube.com/watch?v=...\nRenai Circulation / Kana Hanazawa' });
		var saved = '';
		try { saved = root.sessionStorage.getItem('ts.paste') || ''; } catch (e) { /* private window */ }
		ta.value = saved;
		view.appendChild(ta);
		var out = h('div');
		var go = ctx.U.btn({ icon: 'search', label: 'Read the list', variant: 'primary' });
		view.appendChild(h('div', { class: 'ts-row-btns' }, [go]));
		view.appendChild(out);
		go.addEventListener('click', function () {
			try { root.sessionStorage.setItem('ts.paste', ta.value); } catch (e) { /* private window */ }
			var items = parseList(ta.value).slice(0, MAX);
			ctx.clear(out);
			if (!items.length) { out.appendChild(h('p', { class: 'ts-muted', text: 'Nothing to read: one song a line.' })); return; }
			var ids = items.filter(function (it) { return it.videoId; }).map(function (it) { return it.videoId; });
			known(ctx, ids).then(function (meta) {
				var finds = items.filter(function (it) { return !it.videoId || meta[it.videoId] !== null; }).map(function (it) { return findOf(ctx, it, it.videoId ? meta[it.videoId] : null); });
				var need = finds.filter(function (f) { return !f.videoId; }).length;
				out.appendChild(h('p', { class: 'ts-muted', text: finds.length + ' songs' + (need ? ': ' + need + ' of them are looked up on YouTube when they play (a search each, 100 units, unless the library or an earlier search has them).' : '.') }));
				out.appendChild(listActions(ctx, finds, 'Pasted list', '#/paste'));
				var ul = h('ul', { class: 'ts-share-list' });
				finds.forEach(function (f, i) { ul.appendChild(rowFor(ctx, f, i, finds)); });
				out.appendChild(ul);
			});
		});
	}

	function view(viewEl, ctx, parts, query) {
		addCss(ctx);
		var r = ctx.route();
		if (r && r.parts[0] === 'paste') viewPaste(viewEl, ctx); else viewShare(viewEl, ctx, query);
	}

	return { link: link, decode: decode, parseList: parseList, videoIdOf: videoIdOf, titles: titles, seekOnPlay: seekOnPlay, startIn: startIn, view: view, configure: configure, MAX: MAX };
});
