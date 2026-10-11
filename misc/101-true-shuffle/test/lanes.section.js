// lanes: a lane's words for errors (lanes.js explain), the one shape for library tracks and
// found songs (media.js item, whyText, sourceBadge, cost), and a lane's states, run against
// a small stand-in for the page (a fake DOM and a fake ui.js).
module.exports = function (h) {
	var path = require('path');
	var Ln = require(path.join(h.HERE, 'lanes.js'));
	var Me = require(path.join(h.HERE, 'media.js'));
	var L = require(path.join(h.HERE, 'library.js'));
	var A = require(path.join(h.HERE, 'actions.js'));
	var T = require(path.join(h.HERE, 'taxonomy.js'));
	var Src = require(path.join(h.HERE, 'sources.js'));
	var Y = require(path.join(h.HERE, 'yt.js'));

	function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
	function tick() { return wait(0).then(function () { return wait(0); }); }

	// ---- A fake DOM: elements, text, classes, events, isConnected ----------------------------------
	function fakeDom() {
		var doc = { root: null, focused: null };
		function Node(tag) {
			this.tagName = String(tag).toUpperCase();
			this.nodeType = tag === '#text' ? 3 : 1;
			this.childNodes = [];
			this.parentNode = null;
			this.attrs = {};
			this.dataset = {};
			this.listeners = {};
			this.text = '';
			this.hidden = false;
			this.disabled = false;
			this.cls = [];
			var self = this;
			this.style = { setProperty: function (k, v) { self.style[k] = v; } };
			this.classList = {
				add: function () { for (var i = 0; i < arguments.length; i++) if (self.cls.indexOf(arguments[i]) < 0) self.cls.push(arguments[i]); },
				remove: function () { var gone = Array.prototype.slice.call(arguments); self.cls = self.cls.filter(function (c) { return gone.indexOf(c) < 0; }); },
				toggle: function (c, on) { if (on === undefined) on = self.cls.indexOf(c) < 0; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
				contains: function (c) { return self.cls.indexOf(c) >= 0; }
			};
		}
		function matches(n, sel) {
			return sel.split(',').some(function (s) {
				s = s.trim();
				if (s.charAt(0) === '.') return s.slice(1).split('.').every(function (c) { return n.cls.indexOf(c) >= 0; });
				return n.tagName === s.toUpperCase();
			});
		}
		Node.prototype = {
			get firstChild() { return this.childNodes[0] || null; },
			get className() { return this.cls.join(' '); },
			set className(v) { this.cls = String(v).split(/\s+/).filter(Boolean); },
			get id() { return this.attrs.id || ''; },
			set id(v) { this.attrs.id = String(v); },
			get title() { return this.attrs.title || ''; },
			set title(v) { this.attrs.title = String(v); },
			get textContent() { return this.text + this.childNodes.map(function (c) { return c.textContent; }).join(''); },
			set textContent(v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; this.text = String(v); },
			get isConnected() { for (var n = this; n; n = n.parentNode) if (n === doc.root) return true; return false; },
			get nextElementSibling() { var p = this.parentNode; if (!p) return null; var i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; },
			get previousElementSibling() { var p = this.parentNode; if (!p) return null; var i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; },
			appendChild: function (n) { if (n.parentNode) n.parentNode.removeChild(n); this.childNodes.push(n); n.parentNode = this; return n; },
			insertBefore: function (n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); n.parentNode = this; return n; },
			removeChild: function (n) { var i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; },
			setAttribute: function (k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); },
			getAttribute: function (k) { return k in this.attrs ? this.attrs[k] : null; },
			removeAttribute: function (k) { delete this.attrs[k]; },
			hasAttribute: function (k) { return k in this.attrs; },
			addEventListener: function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
			removeEventListener: function (t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(function (f) { return f !== fn; }); },
			dispatch: function (t, ev) {
				ev = ev || {};
				ev.type = t;
				ev.target = ev.target || this;
				ev.preventDefault = function () { ev.defaultPrevented = true; };
				ev.stopPropagation = function () {};
				for (var n = this; n; n = n.parentNode) { ev.currentTarget = n; (n.listeners[t] || []).slice().forEach(function (fn) { fn(ev); }); }
				return ev;
			},
			click: function () { if (!this.disabled) this.dispatch('click'); },
			focus: function () { doc.focused = this; },
			closest: function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; },
			querySelectorAll: function (sel) { var out = []; (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }); })(this); return out; },
			querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; }
		};
		function el(tag, opts, kids) {
			var e = new Node(tag);
			opts = opts || {};
			Object.keys(opts).forEach(function (k) {
				var v = opts[k];
				if (v == null || v === false) return;
				if (k === 'class') e.className = v;
				else if (k === 'text') e.textContent = v;
				else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
				else if (k === 'aria') Object.keys(v).forEach(function (a) { if (v[a] != null) e.setAttribute('aria-' + a, String(v[a])); });
				else if (k === 'data') Object.keys(v).forEach(function (d) { if (v[d] != null) e.dataset[d] = String(v[d]); });
				else if (k === 'style') Object.keys(v).forEach(function (s) { e.style.setProperty(s, v[s]); });
				else if (k === 'hidden' || k === 'disabled') e[k] = !!v;
				else e.setAttribute(k, v === true ? '' : String(v));
			});
			(Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(function (c) {
				if (c == null || c === false) return;
				if (typeof c === 'string' || typeof c === 'number') { var t = new Node('#text'); t.text = String(c); e.appendChild(t); } else e.appendChild(c);
			});
			return e;
		}
		doc.root = el('html');
		doc.body = doc.root.appendChild(el('body'));
		var menus = [], toasts = [];
		var U = {
			btn: function (o) {
				var b = el(o.href ? 'a' : 'button', { class: 'ts-btn ts-btn--' + (o.variant || (o.iconOnly ? 'icon' : 'secondary')) + (o.iconOnly ? ' is-icon' : '') + (o.cls ? ' ' + o.cls : ''), title: o.title, disabled: o.disabled, on: o.on, aria: o.aria });
				b.dataset.label = o.label || '';
				b.dataset.icon = o.icon || '';
				if (!o.iconOnly) b.appendChild(el('span', { class: 'ts-btn-label', text: o.label || '' }));
				U.btnState(b, { cost: o.cost, busy: o.busy });
				return b;
			},
			btnState: function (b, s) {
				if (s.label != null) { b.dataset.label = s.label; var l = b.querySelector('.ts-btn-label'); if (l) l.textContent = s.label; }
				if (s.icon) b.dataset.icon = s.icon;
				if ('cost' in s) b.dataset.cost = s.cost ? String(s.cost) : '';
				if (s.busy != null) { b.dataset.busy = s.busy ? '1' : ''; b.disabled = !!s.busy; }
				return b;
			},
			badge: function (kind, text, cls) { return el('span', { class: 'ts-badge ts-badge--' + kind + (cls ? ' ' + cls : ''), text: text }); },
			art: function (id, hue, text, cls, useImage) { return el('span', { class: 'ts-art ' + (cls || ''), data: { art: useImage ? id : 'swatch' } }); },
			swatch: function (hue, text, cls) { return el('span', { class: 'ts-art ts-art-gen ' + (cls || ''), data: { art: 'swatch' } }); },
			icon: function (n) { return el('svg', { class: 'ts-i', data: { icon: n } }); },
			setIcon: function (b, n) { b.dataset.icon = n; },
			initialOf: function (s) { return String(s || '?').charAt(0); },
			openMenu: function (at, items, opts) { menus.push({ at: at, items: items, opts: opts }); return el('div', { class: 'ts-menu' }); },
			toast: function (text, opts) { toasts.push({ text: text, opts: opts || {} }); }
		};
		return { doc: doc, el: el, U: U, menus: menus, toasts: toasts };
	}
	function textOf(n) { return n ? n.textContent : ''; }

	h.describe('lanes', async function () {
		// ---- explain: every code, in words for the listener ----
		var NOW = Date.UTC(2026, 9, 10, 20, 0, 0);   // 13:00 in California, 15:00 in Texas
		function SE(code, host, extra) { return Src.SourceError(code, 'raw ' + code, Object.assign({ host: host }, extra || {})); }
		var x;
		x = Ln.explain(SE('offline', 'animethemes'), { now: NOW });
		h.eq([x.code, x.text, x.fix], ['offline', 'This device is offline, so AnimeThemes cannot be asked. This loads again when the connection is back.', { label: 'Try again', kind: 'retry' }], 'explain: offline names the source and says it loads again by itself');
		x = Ln.explain(SE('network', 'deezer'), { now: NOW });
		h.eq([x.code, x.text, x.fix.kind], ['network', 'Deezer did not answer. Check the connection, then try again.', 'retry'], 'explain: network');
		x = Ln.explain(SE('network', 'itunes'), { now: NOW, online: false });
		h.eq([x.code, x.text.indexOf('This device is offline, so iTunes') === 0], ['offline', true], 'explain: a network failure while the device is offline is said as offline');
		x = Ln.explain(SE('down', 'animethemes'), { now: NOW });
		h.eq([x.code, x.text, x.retryMs, x.fix.kind], ['down', 'AnimeThemes is not answering. It is asked again in a minute.', 60000, 'retry'], 'explain: a source that is down says when it is asked again, and the lane asks then');
		x = Ln.explain(SE('down', 'animethemes'), { now: NOW, noAuto: true });
		h.eq([x.text, x.retryMs], ['AnimeThemes is not answering. Try again in a minute.', undefined], 'explain: once the lane stops asking by itself, the words say to try again');
		x = Ln.explain(SE('rate', 'itunes'), { now: NOW });
		h.eq([x.code, x.text, x.retryMs], ['rate', 'iTunes asked for fewer requests. It is asked again in a minute.', 60000], 'explain: rate');
		h.eq(Ln.explain(SE('rate', 'lastfm'), { now: NOW }).retryMs, 30000, 'explain: Last.fm\'s pause is half a minute');
		h.eq(Ln.explain(SE('rate', 'itunes', { retryMs: 5 * 60000 }), { now: NOW }).text, 'iTunes asked for fewer requests. It is asked again in about 5 minutes.', 'explain: a wait the error carries');
		x = Ln.explain(SE('server', 'anilist'), { now: NOW });
		h.eq([x.code, x.text, x.fix.kind], ['server', 'AniList is having trouble answering. Try again later.', 'retry'], 'explain: server');
		x = Ln.explain(SE('not-found', 'animethemes'), { now: NOW });
		h.eq([x.code, x.text, x.fix], ['not-found', 'AnimeThemes has nothing for this.', null], 'explain: not found, with nothing to try');
		x = Ln.explain(SE('bad', 'vndb'), { now: NOW });
		h.eq([x.code, x.text, x.fix.kind], ['bad', 'raw bad', 'retry'], 'explain: bad keeps the source\'s own sentence');
		x = Ln.explain(Src.SourceError('auth', 'Add a Last.fm API key in Settings to use Last.fm.', { host: 'lastfm' }), { now: NOW });
		h.eq([x.code, x.fix], ['needs-key', { label: 'Add a key', kind: 'key' }], 'explain: Last.fm without a key asks for one');
		x = Ln.explain(SE('auth', 'lastfm', { status: 200 }), { now: NOW });
		h.eq([x.code, x.text, x.fix.kind], ['bad-key', 'Last.fm did not accept the API key. Check it in Settings.', 'key'], 'explain: Last.fm with a wrong key');
		x = Ln.explain(SE('auth', 'itunes', { status: 403 }), { now: NOW });
		h.eq([x.code, x.text, x.fix], ['auth', 'iTunes refused the request.', null], 'explain: another source that refuses');
		x = Ln.explain(SE('aborted', 'itunes'), { now: NOW });
		h.eq([x.code, x.text], ['aborted', 'Stopped.'], 'explain: aborted');
		x = Ln.explain(Y.YTError('signed-out', 'Sign in to read from YouTube.'), { now: NOW });
		h.eq([x.code, x.text, x.fix], ['signed-out', 'This needs YouTube: sign in, or add an API key in Settings.', { label: 'Sign in', kind: 'signin' }], 'explain: signed out offers Sign in');
		x = Ln.explain(Y.YTError('quota', 'x'), { now: NOW, timeZone: 'America/Chicago' });
		h.eq([x.code, x.text.replace(/\s+/g, ' '), x.fix, x.resetMs], ['quota', 'Today' + String.fromCharCode(0x2019) + 's YouTube quota is used up. It starts again at midnight Pacific time (2:00 AM your time), in about 11 hours.', null, 11 * 3600000], 'explain: the YouTube quota, with its reset at midnight Pacific in the listener\'s own time');
		x = Ln.explain(Y.YTError('quota', 'x'), { now: Date.UTC(2026, 9, 11, 6, 40), timeZone: 'America/Los_Angeles' });
		h.eq(x.text.slice(x.text.indexOf('It starts')), 'It starts again at midnight Pacific time, in about 20 minutes.', 'explain: in California the time is not said twice; minutes when it is near');
		x = Ln.explain(Y.YTError('quota', 'x'), { now: Date.UTC(2026, 0, 10, 20, 0), timeZone: 'America/Chicago' });
		h.eq(x.resetMs, 12 * 3600000, 'explain: in winter California is 8 hours behind (noon there, 12 hours to go)');
		x = Ln.explain(Y.YTError('bad-key', 'x'), { now: NOW });
		h.eq([x.code, x.fix], ['bad-key', { label: 'Check the key', kind: 'key' }], 'explain: a bad key');
		h.eq(Ln.explain(Y.YTError('forbidden', 'The YouTube Data API is not switched on for this Google project (step 2 of the setup).'), { now: NOW }).fix.kind, 'settings', 'explain: forbidden goes to Settings, with Google\'s reason');
		h.eq(Ln.explain(Y.YTError('rate', 'x'), { now: NOW }).text, 'YouTube asked for fewer requests. It is asked again in a minute.', 'explain: YouTube\'s rate limit');
		h.eq(Ln.explain(Y.YTError('network', 'x'), { now: NOW }).text, 'YouTube did not answer. Check the connection, then try again.', 'explain: YouTube unreachable');
		h.eq(Ln.explain(Y.YTError('not-found', 'YouTube does not know that playlist (it may have been deleted).'), { now: NOW }).text, 'YouTube does not know that playlist (it may have been deleted).', 'explain: YouTube not found keeps its sentence');
		h.eq([Ln.explain(Y.YTError('needs-write', 'x'), {}).fix.kind, Ln.explain(Y.YTError('config', 'x'), {}).fix.kind, Ln.explain(Y.YTError('denied', 'x'), {}).fix.kind, Ln.explain(Y.YTError('server', 'x'), {}).code, Ln.explain(Y.YTError('bad-request', 'x'), {}).code], ['signin', 'settings', 'signin', 'server', 'bad'], 'explain: the other YouTube codes');
		x = Ln.explain({ none: true, rung: 'search', reason: 'needs-key' }, { now: NOW });
		h.eq([x.code, x.fix.kind], ['needs-key', 'signin'], 'explain: the resolver needs a key or a sign-in');
		x = Ln.explain({ none: true, reason: 'over-budget' }, { now: NOW, timeZone: 'UTC' });
		h.eq([x.code, x.text.replace(/\s+/g, ' ')], ['over-budget', 'Today' + String.fromCharCode(0x2019) + 's YouTube allowance for finding songs is used up. It starts again at midnight Pacific time (7:00 AM your time), in about 11 hours.'], 'explain: the allowance for finding songs');
		h.eq(Ln.explain({ none: true, reason: 'not-found' }, {}).fix, null, 'explain: the resolver found nothing');
		h.eq(Ln.explain({ none: true, reason: 'needs-search' }, {}).code, 'needs-search', 'explain: needs a search');
		x = Ln.explain({ code: 'demo' }, { now: NOW });
		h.eq([x.code, x.text, x.fix], ['demo', 'The demo' + String.fromCharCode(0x2019) + 's songs are invented, so nothing is asked of other sites here.', null], 'explain: the demo');
		h.eq([Ln.explain({ code: 'timeout' }, { source: 'LRCLIB' }).text, Ln.explain({ code: 'busy' }, { source: 'LRCLIB' }).code, Ln.explain({ code: 'http' }, { source: 'LRCLIB' }).code, Ln.explain({ code: 'bad-answer', message: '' }, { source: 'LRCLIB' }).text], ['LRCLIB took too long to answer. Try again in a moment.', 'rate', 'server', 'LRCLIB did not accept the request.'], 'explain: lyrics.js\'s codes, with the lane\'s source name');
		h.eq([Ln.explain(new Error('Deezer could not be reached (timeout).'), {}).text, Ln.explain('Plain words.', {}).text, Ln.explain(null, {}).text, Ln.explain(undefined, { source: 'Deezer' }).text], ['Deezer could not be reached (timeout).', 'Plain words.', 'Something went wrong.', 'Deezer did not answer as expected.'], 'explain: anything else: its message, else plain words');
		h.ok([Ln.explain(new Error('x'), {}), Ln.explain(null, {})].every(function (r) { return r.fix && r.fix.kind === 'retry'; }), 'explain: an unknown error can be tried again');
		var e1 = SE('down', 'animethemes'), before = JSON.stringify(e1);
		Ln.explain(e1, { now: NOW });
		h.eq([JSON.stringify(e1), Ln.explain(e1, { now: NOW })], [before, Ln.explain(e1, { now: NOW })], 'explain: pure (the error is untouched, the same words twice)');

		// ---- media.js item: library tracks, light tracks and finds as one shape ----
		var lib = L.create();
		L.upsert(lib, [
			{ id: 'aaaaaaaaaaa', title: 'Paper Lanterns - Blue Signal', channel: 'Paper Lanterns', durationSec: 201 },
			{ id: 'bbbbbbbbbbb', title: 'Glass Orchard - Winter Almanac', channel: 'Glass Orchard' },
			{ id: 'ccccccccccc', title: 'Neon Abacus - Counting Backwards (Official Audio)', channel: 'some uploader' }
		], { playlistId: 'PL1', now: Date.UTC(2026, 9, 1) });
		lib.tracks.bbbbbbbbbbb.work = 'Starfall Odyssey';
		lib.tracks.bbbbbbbbbbb.role = 'OP';
		var light = { id: 'lllllllllll', title: 'Harbour Lights', artist: 'Tin Lighthouse Trio', playlists: ['local:found'], transient: true, durationSec: 180, foundVia: { source: 'animethemes', key: 'at:song:7', why: [['work', 'Starfall Odyssey']] } };
		var lightFind = Src.find({ key: 'at:song:7', videoId: 'lllllllllll', title: 'Harbour Lights', artist: 'Tin Lighthouse Trio', cover: 'https://s4.anilist.co/file/x.jpg', preview: 'https://audio-ssl.itunes.apple.com/p.m4a', source: 'animethemes', album: 'OST' });
		var saved = [], hidden = [], estimates = [];
		var engine = {
			track: function (id) { return id === light.id ? light : null; },
			find: function (id) { return id === light.id ? lightFind : null; },
			estimate: function (fs) { estimates.push(fs.map(function (f) { return f.key; })); var per = {}; fs.forEach(function (f) { per[f.key] = f.key === 'lfm:cheap' ? { rung: 'topic', units: 1, status: 'cheap' } : f.key === 'dz:track:9' ? { rung: 'cache', units: 0, status: 'ready' } : { rung: 'search', units: 101, status: 'search' }; }); return Promise.resolve({ perFind: per }); },
			isSaved: function (k) { return saved.indexOf(k) >= 0; },
			save: function (f) { saved.push(f.key); },
			unsave: function (k) { saved = saved.filter(function (x2) { return x2 !== k; }); },
			hide: function (kind, value) { hidden.push([kind, value]); return function () { hidden = hidden.filter(function (x2) { return !(x2[0] === kind && x2[1] === value); }); }; },
			list: function (finds, o) { calls.push(['list', finds.map(function (f) { return f.key; }), o.label]); return Promise.resolve(['x']); }
		};
		var calls = [];
		var base = { lib: function () { return lib; }, L: L, T: T, A: A, engine: function () { return engine; }, canRead: function () { return true; }, demo: false, prefs: function () { return { art: true }; } };

		var t = Me.item(lib.tracks.aaaaaaaaaaa, base);
		h.eq([t.key, t.videoId, t.title, t.artist, t.durationSec, t.source, t.mine, t.kind, t.find, t.track === lib.tracks.aaaaaaaaaaa, t.sameRecording], ['v:aaaaaaaaaaa', 'aaaaaaaaaaa', 'Blue Signal', 'Paper Lanterns', 201, 'library', 'aaaaaaaaaaa', 'track', null, true, true], 'item: a library track');
		var t2 = Me.item(lib.tracks.bbbbbbbbbbb, base);
		h.eq([t2.work, t2.role, Me.item('bbbbbbbbbbb', base).key], ['Starfall Odyssey', 'OP', 'v:bbbbbbbbbbb'], 'item: its work and role, and a library id works too');
		var t3 = Me.item(lib.tracks.ccccccccccc, base);
		h.eq([t3.title, t3.artist, t3.guess], ['Neon Abacus - Counting Backwards', 'some uploader', true], 'item: an artist that is only a guess says so');
		var lt = Me.item(light, base);
		h.eq([lt.kind, lt.key, lt.mine, lt.source, lt.cover, lt.preview, lt.album, lt.why, lt.find === lightFind, lt.track === light], ['light', 'at:song:7', null, 'animethemes', 'https://s4.anilist.co/file/x.jpg', 'https://audio-ssl.itunes.apple.com/p.m4a', 'OST', [['work', 'Starfall Odyssey']], true, true], 'item: a light track (a find the queue holds) carries its find');
		h.eq(Me.item('lllllllllll', base).kind, 'light', 'item: a light track by its id, through the engine');
		var f = Me.item({ key: 'at:song:12', title: 'Night Ferry', artist: 'Moth Radio', work: 'Starfall Odyssey', role: 'ED', seq: 2, season: { year: 2026, season: 'fall' }, durationSec: 92, cover: 'https://evil.example/x.jpg', preview: 'https://cdnt-preview.dzcdn.net/p.mp3', source: 'animethemes', why: [['work', 'Starfall Odyssey'], ['season', { year: 2026, season: 'fall' }]] }, base);
		h.eq([f.kind, f.key, f.videoId, f.title, f.artist, f.work, f.role, f.seq, f.durationSec, f.cover, f.preview, f.source, f.mine, f.track, f.find.key], ['find', 'at:song:12', null, 'Night Ferry', 'Moth Radio', 'Starfall Odyssey', 'ED', 2, 92, '', 'https://cdnt-preview.dzcdn.net/p.mp3', 'animethemes', null, null, 'at:song:12'], 'item: a find, its picture checked against the allowed hosts');
		var f2 = Me.item({ key: 'v:aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', title: 'Paper Lanterns - Blue Signal', source: 'ytuploads' }, base);
		h.eq([f2.mine, f2.track === lib.tracks.aaaaaaaaaaa, f2.sameRecording, f2.kind], ['aaaaaaaaaaa', true, true, 'find'], 'item: a find whose video is in the library is the library\'s song');
		var f3 = Me.item({ key: 'it:track:5', title: 'Blue Signal', artist: 'Paper Lanterns', source: 'itunes', ids: { it: 5 } }, base);
		h.eq([f3.mine, f3.track, f3.sameRecording], ['aaaaaaaaaaa', null, true], 'item: a find the library has under another upload (match.js inLibrary)');
		var f4 = Me.item({ key: 'it:track:6', title: 'Blue Signal (Live)', artist: 'Paper Lanterns', version: 'live', source: 'itunes', ids: { it: 6 } }, base);
		h.eq([f4.mine, f4.sameRecording], ['aaaaaaaaaaa', false], 'item: another version of a song you have: in the library, not the same recording');
		h.eq(Me.item({ title: 'Free Song', artist: 'Nobody Known', source: 'lastfm' }, base).key, 'lfm:nobodyknown|freesong', 'item: a find without a key gets one (sources.js find)');
		h.eq(Me.item({ t: lib.tracks.aaaaaaaaaaa, score: 4, why: [['together', 3]] }, base).why, [['together', 3]], 'item: S.similar\'s { t, why } keeps its reasons');
		h.eq([Me.item({ t: lib.tracks.aaaaaaaaaaa, why: 'also from Starfall Odyssey' }, base).why, Me.whyText(Me.item({ t: lib.tracks.aaaaaaaaaaa, why: 'also from Starfall Odyssey' }, base))], [['also from Starfall Odyssey'], 'Also from Starfall Odyssey'], 'item: a reason already in words (the page\'s similar)');
		var asked = 0;
		var withIx = Object.assign({}, base, { libIndex: function () { asked++; return require(path.join(h.HERE, 'match.js')).index(L.list(lib)); } });
		h.eq([Me.item({ key: 'it:track:5', title: 'Blue Signal', artist: 'Paper Lanterns', source: 'itunes', ids: { it: 5 } }, withIx).mine, asked], ['aaaaaaaaaaa', 1], 'item: the page\'s own library index when it has one (ctx.libIndex)');
		h.ok(Me.item(t, base) === t, 'item: an item passes through');
		h.eq([Me.item(null, base), Me.item('no-such-id', base), Me.item(42, base)], [null, null, null], 'item: nothing for nothing');
		var bare = Me.item({ key: 'dz:track:1', title: 'X', artist: 'Y', source: 'deezer', ids: { dz: 1 } });
		h.eq([bare.mine, bare.kind], [null, 'find'], 'item: without a page context (no library to ask)');

		// ---- why, the source badge, the cost ----
		h.eq(Me.whyText(f, 2, base), 'From Starfall Odyssey ' + String.fromCharCode(0xB7) + ' airing in fall 2026', 'whyText: two reasons, the first capitalised');
		h.eq(Me.whyText({ why: [['mix', 'Blue Signal'], ['singer', 'Lia'], ['channel', 'wound']] }, 3), 'In the YouTube Mix of ' + String.fromCharCode(0x201C) + 'Blue Signal' + String.fromCharCode(0x201D) + ' ' + String.fromCharCode(0xB7) + ' also sung by Lia ' + String.fromCharCode(0xB7) + ' uploaded by wound', 'whyText: a Mix, a singer, a channel');
		h.eq([Me.whyText({ why: [['mood', 'wistful']] }, 2, { T: T }), Me.whyText({ why: [['together', 1]] }), Me.whyText({ why: [['together', 4]] }), Me.whyText({ why: [['artist', '']] }), Me.whyText({ why: [['familiar', '']] })], ['Also wistful', 'Played right after it', 'Played together 4 times', 'Same artist', 'From your library'], 'whyText: S.similar\'s and the feeder\'s reasons');
		h.eq([Me.whyText({ why: [['constructor', 'odd'], ['', 'Plain reason'], 'a string'] }, 3), Me.whyText({ why: [['work', 'A'], ['work', 'A']] }), Me.whyText({ why: null }), Me.whyText(null)], ['Odd ' + String.fromCharCode(0xB7) + ' Plain reason ' + String.fromCharCode(0xB7) + ' a string', 'From A', '', ''], 'whyText: an unknown kind is its value; no reason twice');
		h.eq([Me.sourceBadge(f), Me.sourceBadge(t), Me.sourceBadge(lt), Me.sourceBadge({ kind: 'find', source: 'ytmix' }), Me.sourceBadge({ kind: 'find', source: 'constructor' }), Me.sourceBadge({ kind: 'find', source: '' })], [['anime', 'Anime'], null, ['anime', 'Anime'], ['mix', 'Mix'], null, null], 'sourceBadge: a find\'s source as a ds.css badge; a library song has none');
		var est = function (status) { return { status: status }; };
		h.eq([Me.cost(base, t), Me.cost(base, lt), Me.cost(base, f2), Me.cost(base, f3), Me.cost(base, f4), Me.cost(base, f), Me.cost(Object.assign({}, base, { canRead: function () { return false; } }), f)], [0, 0, 0, 0, 100, 100, 'tab'], 'cost: free when known or yours; a search otherwise; a new tab without a key or a sign-in');
		h.eq([Me.cost(base, f, est('ready')), Me.cost(base, f, est('cheap')), Me.cost(base, f, est('search')), Me.cost(base, f, est('needs-key')), Me.cost(base, f, est('over-budget')), Me.cost(base, f, est('not-found'))], [0, 1, 100, 'tab', 100, 100], 'cost: from the engine\'s estimate');

		// ---- media.js in a fake page: a row, its menu, playing ----
		var dom = fakeDom(), el = dom.el, U = dom.U;
		var navs = [];
		var ctx = Object.assign({}, base, {
			h: el, U: U, icon: U.icon, clear: function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; },
			words: { clock: function (s) { return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); } },
			art: function (tr, cls) { return el('span', { class: 'ts-art ' + cls, data: { art: 'track:' + tr.id } }); },
			hue: function () { return { h: 200, s: 50 }; },
			play: {
				now: function (ids, c) { calls.push(['now', ids, c && c.label]); },
				next: function (ids) { calls.push(['next', ids]); },
				later: function (ids) { calls.push(['later', ids]); },
				from: function (ids, i, c) { calls.push(['from', ids, i, c.label]); },
				find: function (fd, mode) { calls.push(['find', fd.key, mode]); return Promise.resolve({ videoId: 'zzzzzzzzzzz' }); }
			},
			preview: function (it2) { calls.push(['preview', it2.key]); },
			nav: function (x2) { navs.push(x2); }
		});
		var cheap = Me.item({ key: 'lfm:cheap', title: 'Cheap Song', artist: 'Moth Radio', source: 'lastfm' }, ctx);
		var known = Me.item({ key: 'dz:track:9', title: 'Known Song', artist: 'Copper Sea', source: 'deezer', ids: { dz: 9 } }, ctx);
		var items = [t, f, cheap, known, lt];
		var ol = Me.list(ctx, items, { numbered: true, context: { label: 'A lane', href: '#/x' } });
		dom.doc.body.appendChild(ol);
		var rows = ol.childNodes;
		h.eq(rows.map(function (r) { return r.dataset.key; }), ['v:aaaaaaaaaaa', 'at:song:12', 'lfm:cheap', 'dz:track:9', 'at:song:7'], 'row: one row a song, in order');
		h.eq([textOf(rows[0].querySelector('.ts-m-idx')), textOf(rows[0].querySelector('.ts-m-tt')), rows[0].querySelector('.ts-m-mine') ? 'check' : '', textOf(rows[0].querySelector('.ts-m-dur'))], ['1', 'Blue Signal', 'check', '3:21'], 'row: number, title, the in-library check, the length');
		h.eq([textOf(rows[1].querySelector('.ts-tag')), textOf(rows[1].querySelector('.ts-m-sub')), textOf(rows[1].querySelector('.ts-m-why')), textOf(rows[1].querySelector('.ts-badge')), rows[1].querySelector('.ts-m-mine')], ['ED2', 'Moth Radio ' + String.fromCharCode(0xB7) + ' Starfall Odyssey', 'From Starfall Odyssey ' + String.fromCharCode(0xB7) + ' airing in fall 2026', 'Anime', null], 'row: a find\'s role, artist and work, why it is here, its source');
		h.eq(rows.map(function (r) { return r.querySelector('.ts-m-play').dataset.cost; }), ['', '100', '100', '100', ''], 'row: before the estimate, a cost on the songs that need a search');
		await tick();
		h.eq(estimates, [['at:song:12', 'lfm:cheap', 'dz:track:9']], 'row: one estimate for every row drawn together');
		h.eq(rows.map(function (r) { return r.querySelector('.ts-m-play').dataset.cost; }), ['', '100', '1', '', ''], 'row: the estimate sets the badges (100 for a search, 1 for a cheap lookup, none when found before)');
		h.ok(!!rows[1].querySelector('.ts-m-pv') && !rows[0].querySelector('.ts-m-pv'), 'row: Preview when the song has one and the page can play it');
		rows[0].querySelector('.ts-m-play').click();
		rows[0].querySelector('.ts-m-next').click();
		rows[1].querySelector('.ts-m-play').click();
		rows[1].querySelector('.ts-m-next').click();
		rows[1].querySelector('.ts-m-pv').click();
		await tick();
		h.eq(calls, [['now', ['aaaaaaaaaaa'], 'A lane'], ['next', ['aaaaaaaaaaa']], ['find', 'at:song:12', 'now'], ['find', 'at:song:12', 'next'], ['preview', 'at:song:12']], 'row: Play and Play next, a library song through the page\'s queue, a find through ctx.play.find');
		h.eq(rows[1].querySelector('.ts-m-play').dataset.cost, '', 'row: once played (found), the badge goes');
		calls.length = 0;
		var compact = Me.row(ctx, f, { compact: true });
		h.eq([compact.querySelectorAll('button').length, !!compact.querySelector('.ts-m-idx'), !!compact.querySelector('.ts-m-meta'), textOf(compact.querySelector('.ts-m-sub'))], [3, false, false, 'Moth Radio ' + String.fromCharCode(0xB7) + ' From Starfall Odyssey ' + String.fromCharCode(0xB7) + ' airing in fall 2026'], 'row: compact has three buttons (Play, Play next, More) and puts the reason in the line');
		h.eq([textOf(Me.row(ctx, t, { index: 7 }).querySelector('.ts-m-idx')), Me.row(ctx, t, {}).querySelector('.ts-m-idx')], ['7', null], 'row: the number column shows the index it is given (an album\'s track 7)');
		var custom = Me.row(ctx, f, { badge: ['season', 'Airing'], why: 'Custom reason', sub: function (it2) { return 'by ' + it2.artist; }, onPlay: function (it2, mode) { calls.push(['own', it2.key, mode]); } });
		custom.querySelector('.ts-m-play').click();
		await tick();
		h.eq([textOf(custom.querySelector('.ts-badge')), textOf(custom.querySelector('.ts-m-why')), textOf(custom.querySelector('.ts-m-sub')), calls], ['Airing', 'Custom reason', 'by Moth Radio', [['own', 'at:song:12', 'now']]], 'row: the badge, the reason and the line can be the page\'s own; onPlay replaces Play');
		calls.length = 0;

		// the menu
		rows[2].querySelector('.ts-m-more').click();
		h.eq([dom.menus[0].items[1].label, dom.menus[0].items[1].hint, dom.menus[0].opts.label], ['Play', '1 unit', 'Actions for Cheap Song'], 'menu: Play says what it costs');
		rows[1].querySelector('.ts-m-more').click();
		var m = dom.menus[dom.menus.length - 1];
		var labels = m.items.map(function (it2) { return it2.heading ? '# ' + it2.heading : it2.sep ? '--' : it2.label; });
		h.eq(labels, ['# Night Ferry', 'Play', 'Play from here', 'Play next', 'Add to queue', '# Keep', 'Preview', 'Save for later', 'Not interested', 'Not interested in Moth Radio', '# Go to', 'Go to Starfall Odyssey', 'Explore'], 'menu: a find: play, play from here, queue; keep (preview, save, not interested); go to its work and Explore');
		function pick(menu0, label) { var x0 = menu0.items.filter(function (it2) { return it2.label === label; })[0]; x0.onSelect(); return x0; }
		pick(m, 'Save for later');
		h.eq([saved, dom.toasts[dom.toasts.length - 1].text], [['at:song:12'], 'Saved for later: Night Ferry.'], 'menu: Save for later, with Undo');
		dom.toasts[dom.toasts.length - 1].opts.onAction();
		h.eq(saved, [], 'menu: Undo takes it back');
		pick(m, 'Not interested');
		h.eq([hidden, rows[1].classList.contains('is-hidden'), dom.doc.focused === rows[2].querySelector('.ts-m-play')], [[['song', 'at:song:12']], true, true], 'menu: Not interested hides the song (engine.hide), the row goes, the focus moves on');
		dom.toasts[dom.toasts.length - 1].opts.onAction();
		h.eq([hidden, rows[1].classList.contains('is-hidden')], [[], false], 'menu: Undo brings it back');
		pick(m, 'Explore');
		pick(m, 'Go to Starfall Odyssey');
		pick(m, 'Play from here');
		h.eq([navs, calls[0]], [['#/explore/find/at%3Asong%3A12', '#/work/Starfall%20Odyssey'], ['list', ['at:song:12', 'lfm:cheap', 'dz:track:9', 'at:song:7'], 'A lane']], 'menu: Explore and Go to; Play from here plays the rest of the list through the engine');
		calls.length = 0;
		navs.length = 0;
		Me.menu(ctx, t, rows[0].querySelector('.ts-m-more'), { list: [t, Me.item(lib.tracks.bbbbbbbbbbb, ctx)], context: { label: 'Mine' } });
		m = dom.menus[dom.menus.length - 1];
		labels = m.items.map(function (it2) { return it2.heading ? '# ' + it2.heading : it2.label; });
		h.eq(labels, ['# Blue Signal', 'Play', 'Play from here', 'Play next', 'Add to queue', '# Go to', 'Go to Paper Lanterns', 'Explore', 'Song details', 'Open on YouTube'], 'menu: a library song: no Save or Not interested; its artist, Explore, details, YouTube');
		pick(m, 'Play from here');
		pick(m, 'Explore');
		h.eq([calls[0], navs[0]], [['from', ['aaaaaaaaaaa', 'bbbbbbbbbbb'], 0, 'Mine'], '#/explore/aaaaaaaaaaa'], 'menu: library songs play from here through the page\'s own list; Explore goes to the library id');
		calls.length = 0;
		var demoCtx = Object.assign({}, ctx, { demo: true });
		Me.menu(demoCtx, t, null, {});
		h.ok(dom.menus[dom.menus.length - 1].items.every(function (it2) { return it2.label !== 'Open on YouTube'; }), 'menu: not Open on YouTube in the demo');
		var card = Me.card(ctx, f, { context: { label: 'Cards' } });
		h.eq([card.querySelector('.ts-card-a').getAttribute('href'), textOf(card.querySelector('.ts-card-title')), textOf(card.querySelector('.ts-card-sub')), textOf(card.querySelector('.ts-badge--cost')), card.querySelector('.ts-bigplay').getAttribute('aria-label')], ['#/explore/find/at%3Asong%3A12', 'Night Ferry', 'Moth Radio ' + String.fromCharCode(0xB7) + ' From Starfall Odyssey', '100', 'Play Night Ferry, uses 100 YouTube units'], 'card: Explore on the card, the title, a line, the cost on the art, Play over it');
		card.querySelector('.ts-bigplay').click();
		await tick();
		h.eq(calls, [['find', 'at:song:12', 'now']], 'card: its Play plays the find');
		calls.length = 0;

		// ---- the lane's states ----
		var host = el('div');
		dom.doc.body.appendChild(host);
		function deferred() { var d = {}; d.promise = new Promise(function (res, rej) { d.resolve = res; d.reject = rej; }); return d; }
		function body(l) { return l.node.querySelector('.ts-lane-body'); }
		var d1 = deferred(), signal1 = null;
		var lane = Ln.mount(host, ctx, { id: 'one', title: 'Same anime', badge: 'anime', layout: 'rows', limit: 2, empty: 'No songs.', load: function (s) { signal1 = s; return d1.promise; } });
		h.eq([lane.state(), lane.node.getAttribute('aria-busy'), lane.node.dataset.lane, textOf(lane.node.querySelector('.ts-lane-title')), textOf(lane.node.querySelector('.ts-badge')), body(lane).querySelectorAll('.ts-lane-skrow').length], ['loading', 'true', 'one', 'Same anime', 'Anime', 2], 'lane: loading shows a skeleton of its rows (as many as it will show), aria-busy');
		d1.resolve({ items: [t, f, cheap, known], note: 'From AnimeThemes.' });
		await tick();
		h.eq([lane.state(), lane.node.getAttribute('aria-busy'), body(lane).querySelectorAll('.ts-m-row').length, textOf(lane.node.querySelector('.ts-lane-note')), textOf(lane.node.querySelector('.ts-lane-more'))], ['ready', 'false', 2, 'From AnimeThemes.', 'Show 2 more'], 'lane: ready: rows up to the limit, its note, Show more');
		lane.node.querySelector('.ts-lane-more').click();
		h.eq([body(lane).querySelectorAll('.ts-m-row').length, lane.node.querySelector('.ts-lane-more'), dom.doc.focused === body(lane).querySelectorAll('.ts-m-play')[2]], [4, null, true], 'lane: Show more adds the rest and takes the focus to the first new row');
		h.ok(lane.data().items.length === 4 && signal1 && !signal1.aborted, 'lane: data() is what the load gave');

		var empty = Ln.mount(host, ctx, { id: 'none', title: 'Nothing', empty: 'Nothing from this channel yet.', load: function () { return Promise.resolve({ items: [] }); } });
		await tick();
		h.eq([empty.state(), textOf(body(empty))], ['empty', 'Nothing from this channel yet.'], 'lane: empty says the lane\'s own words');
		var empty2 = Ln.mount(host, ctx, { id: 'none2', title: 'Nothing', load: function () { return Promise.resolve(null); } });
		await tick();
		h.eq([empty2.state(), textOf(body(empty2))], ['empty', 'Nothing here yet.'], 'lane: never blank, even with no words of its own');

		var tries = 0;
		var bad = Ln.mount(host, ctx, { id: 'bad', title: 'Similar songs', load: function () { tries++; return tries === 1 ? Promise.reject(Src.SourceError('server', 'x', { host: 'deezer' })) : Promise.resolve([known]); } });
		await tick();
		h.eq([bad.state(), textOf(body(bad).querySelector('p')), textOf(body(bad).querySelector('.ts-lane-retry'))], ['error', 'Deezer is having trouble answering. Try again later.', 'Try again'], 'lane: an error in words, with Try again');
		body(bad).querySelector('.ts-lane-retry').click();
		h.eq(bad.state(), 'loading', 'lane: Try again loads again');
		await tick();
		h.eq([bad.state(), tries, body(bad).querySelectorAll('.ts-m-row').length], ['ready', 2, 1], 'lane: and comes back ready');
		var sync = Ln.mount(host, ctx, { id: 'throws', title: 'Throws', load: function () { throw new Error('Broken loader.'); } });
		await tick();
		h.eq([sync.state(), textOf(body(sync).querySelector('p'))], ['error', 'Broken loader.'], 'lane: a loader that throws is an error, not a blank');
		var fixes = [];
		var signed = Ln.mount(host, Object.assign({}, ctx, { fix: function (kind) { fixes.push(kind); } }), { id: 'yt', title: 'From YouTube', load: function () { return Promise.reject(Y.YTError('signed-out', 'x')); } });
		await tick();
		body(signed).querySelector('.ts-lane-fix').click();
		h.eq([signed.state(), textOf(body(signed).querySelector('.ts-lane-fix')), fixes], ['error', 'Sign in', ['signin']], 'lane: the fix button (Sign in) goes to the page');
		var downs = 0;
		var down = Ln.mount(host, ctx, { id: 'down', title: 'Down', load: function () { downs++; return Promise.reject(Src.SourceError('down', 'x', { host: 'animethemes', retryMs: 20 })); } });
		await tick();
		h.eq([down.state(), textOf(body(down).querySelector('p'))], ['error', 'AnimeThemes is not answering. It is asked again in a minute.'], 'lane: a source that is down: when it is asked again');
		await wait(200);
		h.eq([downs, down.state(), textOf(body(down).querySelector('p'))], [4, 'error', 'AnimeThemes is not answering. Try again in a minute.'], 'lane: asked again by itself three times, then it says to try again');

		var asked = 0, runs = 0, on = false;
		var un = Ln.mount(host, ctx, {
			id: 'lfm', title: 'Last.fm', load: function () { asked++; return Promise.resolve([cheap]); },
			unavailable: function () { return on ? null : { text: 'Similar songs need a Last.fm key.', fix: { label: 'Add a key', run: function () { runs++; on = true; } } }; }
		});
		h.eq([un.state(), textOf(body(un).querySelector('p')), textOf(body(un).querySelector('.ts-lane-fix')), asked], ['unavailable', 'Similar songs need a Last.fm key.', 'Add a key', 0], 'lane: unavailable is asked first: its words, its fix, nothing loaded');
		body(un).querySelector('.ts-lane-fix').click();
		await tick();
		h.eq([runs, un.state(), asked], [1, 'ready', 1], 'lane: the fix runs, and a lane that is available now loads');

		var d2 = deferred(), sig2 = null;
		var gone = Ln.mount(host, ctx, { id: 'gone', title: 'Gone', load: function (s) { sig2 = s; return d2.promise; } });
		gone.destroy();
		d2.resolve([t]);
		await tick();
		h.eq([sig2.aborted, gone.state(), gone.node.parentNode, gone.data()], [true, 'loading', null, null], 'lane: destroyed: the load is aborted, the late answer dropped, the section removed');
		var d3 = deferred();
		var left = Ln.mount(host, ctx, { id: 'left', title: 'Left', load: function () { return d3.promise; } });
		host.removeChild(left.node);
		d3.resolve([t]);
		await tick();
		h.eq([left.state(), left.data()], ['loading', null], 'lane: an answer for a lane that left the page is dropped');

		var loads = 0;
		function cached() { return { id: 'mem', title: 'Kept', key: 'test:kept', load: function () { loads++; return Promise.resolve([t, f]); } }; }
		Ln.forget('test:');
		var k1 = Ln.mount(host, ctx, cached());
		await tick();
		var k2 = Ln.mount(host, ctx, cached());
		h.eq([k1.state(), k2.state(), loads, body(k2).querySelectorAll('.ts-m-row').length], ['ready', 'ready', 1, 2], 'lane: the same key again paints at once from memory, without loading');
		k2.reload();
		await tick();
		h.eq([loads, k2.state()], [2, 'ready'], 'lane: reload() loads again');
		Ln.forget('test:kept');
		Ln.mount(host, ctx, cached());
		h.eq(loads, 3, 'lane: forget(key) drops it from memory');

		var lazy = 0;
		var lz = Ln.mount(host, ctx, { id: 'lazy', title: 'Lazy', lazy: true, load: function () { lazy++; return Promise.resolve([t]); } });
		await tick();
		h.eq([lazy, lz.state()], [1, 'ready'], 'lane: lazy without IntersectionObserver loads at once');

		var cards = Ln.mount(host, ctx, { id: 'cards', title: 'Cards', layout: 'cards', limit: 3, seeAll: { href: '#/all', label: 'See all' }, load: function () { return Promise.resolve({ items: [t, f, cheap, known], total: 12 }); } });
		await tick();
		h.eq([body(cards).querySelectorAll('.ts-m-card').length, textOf(cards.node.querySelector('.ts-lane-all')), cards.node.querySelector('.ts-lane-all').getAttribute('href'), cards.node.querySelector('.ts-lane-more')], [3, 'See all', '#/all', null], 'lane: cards up to the limit, then See all (no Show more)');
		var groups = Ln.mount(host, ctx, { id: 'groups', title: 'Starfall Odyssey', layout: 'groups', limit: 1, load: function () { return Promise.resolve({ groups: [{ title: 'Season 1', sub: '2024', items: [t, f] }, { title: 'Empty', items: [] }, { title: 'Season 2', items: [cheap] }] }); } });
		await tick();
		h.eq([groups.node.querySelectorAll('.ts-lane-group').length, groups.node.querySelectorAll('.ts-lane-gt').map(textOf), body(groups).querySelectorAll('.ts-m-row').length, groups.node.querySelectorAll('.ts-lane-more').length], [2, ['Season 1', 'Season 2'], 2, 1], 'lane: groups, each with its title, empty ones left out, Show more per group');
		var acts = Ln.mount(host, ctx, {
			id: 'acts', title: function (d) { return d ? 'Have ' + d.items.length : 'Counting'; }, sub: 'sub line',
			actions: function (d) { return [U.btn({ label: 'Play all' }), U.btn({ label: 'Shuffle' }), U.btn({ label: 'Queue' }), U.btn({ label: 'Save' })]; },
			load: function () { return Promise.resolve([t, f]); }
		});
		h.eq(textOf(acts.node.querySelector('.ts-lane-title')), 'Counting', 'lane: a title that follows the data, while it loads');
		await tick();
		var actBtns = acts.node.querySelector('.ts-lane-acts').childNodes;
		h.eq([textOf(acts.node.querySelector('.ts-lane-title')), textOf(acts.node.querySelector('.ts-lane-sub')), actBtns.length, actBtns[3].dataset.label], ['Have 2', 'sub line', 4, 'More actions'], 'lane: its own buttons in the header, three and More');
		var rend = Ln.mount(host, ctx, { id: 'render', title: 'Custom', render: function (b, d) { b.appendChild(el('p', { text: 'Custom ' + d.value })); }, load: function () { return Promise.resolve(7); } });
		var blank = Ln.mount(host, ctx, { id: 'blank', title: 'Blank', empty: 'Nothing drawn.', render: function () {}, load: function () { return Promise.resolve({ found: { name: 'x' } }); } });
		var drawn = 0;
		function counted(data) { return { id: 'r', title: 'R', empty: 'None.', render: function (b) { drawn++; b.appendChild(el('p', { text: 'drawn' })); }, load: function () { return Promise.resolve(data); } }; }
		var r1 = Ln.mount(host, ctx, counted({ items: [] })), r2 = Ln.mount(host, ctx, counted({ items: [], note: 'unread' })), r3 = Ln.mount(host, ctx, counted({ items: [], found: { sure: true }, total: 4 })), r4 = Ln.mount(host, ctx, counted({ items: [], albums: [] }));
		await tick();
		h.eq([rend.state(), textOf(body(rend)), blank.state(), textOf(body(blank))], ['ready', 'Custom 7', 'empty', 'Nothing drawn.'], 'lane: render draws its own body; one that draws nothing is empty, not blank');
		h.eq([r1.state(), r2.state(), r3.state(), r4.state(), drawn], ['empty', 'ready', 'ready', 'empty', 2], 'lane: with render, empty lists alone are empty; data that carries more (a note, what was found) is drawn');
		var why = Ln.mount(host, ctx, { id: 'whys', title: 'From your library', layout: 'groups', load: function () { return Promise.resolve({ groups: [{ title: 'Sounds close', items: [lib.tracks.aaaaaaaaaaa, lib.tracks.bbbbbbbbbbb], whys: ['also bright', 'played together 3 times'] }] }); } });
		await tick();
		h.eq(body(why).querySelectorAll('.ts-m-why').map(textOf), ['Also bright', 'Played together 3 times'], 'lane: a group\'s whys (one per item) are the rows\' reasons');
		var more = Ln.mount(host, ctx, { id: 'more', title: 'Uploads', load: function () { return Promise.resolve({ items: [t], more: function () { return Promise.resolve({ items: [f, cheap] }); }, moreCost: 1, moreLabel: 'Load older uploads' }); } });
		await tick();
		var lb = more.node.querySelector('.ts-lane-load');
		h.eq([textOf(lb), lb.dataset.cost], ['Load older uploads', '1'], 'lane: Load more, with its cost');
		lb.click();
		await tick();
		h.eq([body(more).querySelectorAll('.ts-m-row').length, more.data().items.length, more.node.querySelector('.ts-lane-load')], [3, 3, null], 'lane: more rows join the list');
		h.eq(Ln.STATES, ['loading', 'ready', 'empty', 'error', 'unavailable'], 'lane: the five states');
	});
};
