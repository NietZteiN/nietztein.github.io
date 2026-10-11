/*
 * True Shuffle: sharing. A queue or a list of songs as a link anyone can
 * open (#/share?ids=<video ids>&t=<title>), with no sign-in and no library:
 * the titles come from YouTube's oEmbed (free, no key) and the songs play
 * as found songs. And a pasted list ("Artist - Title" lines, or YouTube
 * links) turned into songs to play or queue (#/paste).
 *
 *     Sh.link(ids, title, base) -> 'https://.../#/share?ids=a.b.c&t=Title'
 *     Sh.decode(query) -> { ids, title }        Sh.parseList(text) -> [{ videoId } | { artist, title }]
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
	var fetchFn = null;

	function configure(o) { if (o && o.fetch) fetchFn = o.fetch; }
	function doFetch(url) { return (fetchFn || root.fetch)(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }); }

	// A link to these songs (at most 100), with a title.
	function link(ids, title, base) {
		var ok = (ids || []).filter(function (id) { return YT_ID.test(id); });
		var seen = {}, list = [];
		ok.forEach(function (id) { if (!seen[id]) { seen[id] = true; list.push(id); } });
		var h = '#/share?ids=' + list.slice(0, MAX).join('.') + (title ? '&t=' + encodeURIComponent(String(title).slice(0, 120)) : '');
		return (base || '') + h;
	}
	function decode(query) {
		var raw = query && query.get ? query.get('ids') || '' : '';
		var ids = [], seen = {};
		raw.split(/[.,\s]+/).forEach(function (id) { if (YT_ID.test(id) && !seen[id]) { seen[id] = true; ids.push(id); } });
		var title = query && query.get ? (query.get('t') || '').slice(0, 120) : '';
		return { ids: ids.slice(0, MAX), title: title };
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
			'.ts-share-note{max-width:70ch}';
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
		li.appendChild(f.videoId ? U.art(f.videoId, 210, f.title, 'ts-q-art', true) : U.swatch(210, f.title || '?', 'ts-q-art'));
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

	function viewShare(view, ctx, query) {
		var h = ctx.h, d = decode(query);
		ctx.ui.headerBlock(view, { kicker: 'Shared with you', title: d.title || 'Songs to listen to', meta: d.ids.length + ' songs', art: false, hue: { h: 205, s: 50 } });
		if (!d.ids.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'This link has no songs in it.' })); return; }
		view.appendChild(h('p', { class: 'ts-muted ts-share-note', text: 'These play here through YouTube\u2019s own player, with no sign-in. Their titles come from YouTube.' }));
		var box = h('div');
		view.appendChild(box);
		var ul = h('ul', { class: 'ts-share-list', aria: { busy: 'true' } });
		box.appendChild(ul);
		d.ids.forEach(function () { ul.appendChild(h('li', { class: 'ts-share-row' }, [h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title ts-muted', text: 'Loading' + ctx.words.ELL })])])); });
		var here = root.location ? root.location.hash : '';
		known(ctx, d.ids).then(function (meta) {
			if (root.location && root.location.hash !== here) return;
			var finds = d.ids.filter(function (id) { return meta[id] !== null; }).map(function (id) { return findOf(ctx, { videoId: id }, meta[id]); });
			ctx.clear(ul);
			ul.setAttribute('aria-busy', 'false');
			box.insertBefore(listActions(ctx, finds, d.title || 'Shared songs', here), ul);
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

	return { link: link, decode: decode, parseList: parseList, videoIdOf: videoIdOf, titles: titles, view: view, configure: configure, MAX: MAX };
});
