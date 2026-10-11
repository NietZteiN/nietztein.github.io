/*
 * True Shuffle: lanes. A lane is one titled section of a page that loads its
 * own data and is never blank: a skeleton while it loads, then its songs (rows,
 * cards, or rows in groups), or words for why there are none. Nothing was found
 * (the lane's own sentence); an error, said plainly, with what to do about it
 * (Try again, Sign in, add a key); or what the lane needs before it can work at
 * all (unavailable: a sign-in, a key, a source switched off). A lazy lane loads
 * when it comes within 600 px of the screen; a load stops when the lane is
 * destroyed or leaves the page, and an answer that comes late is dropped. With
 * a key, the same lane again in the session paints at once from memory.
 *
 *     var lane = Ln.mount(el, ctx, spec)   -> { node, reload(), state(), data(), destroy() }
 *     Ln.explain(error, { now, online, source, noAuto, timeZone }) -> { code, text, fix, retryMs }
 *     Ln.forget(keyOrPrefix)               forget lanes kept in memory (all of them without one)
 *
 * spec: { id, title, sub, badge, layout: 'rows' | 'cards' | 'groups', load(signal) -> Promise<data>,
 *         unavailable() -> null | { text, fix }, empty, limit, seeAll: { href, label },
 *         actions(data) -> [nodes], render(body, data), row (media.js options), lazy, key,
 *         source, compact, level, grid, maxAgeMs, isEmpty(data), onFix(kind, lane) }
 * data: [items], or { items, groups: [{ title, sub, items }], note, sub, total, more }
 * Items are library tracks, finds or media.js items; rows and cards are media.js's.
 *
 * UMD: window.TrueShuffle.lanes in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, !!node);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.lanes = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, inNode) {
	'use strict';

	var MARGIN = 600;          // px: a lazy lane loads when it comes this close to the screen
	var AUTO_TRIES = 3;        // a source that is down or asked for fewer requests is asked again by itself this often
	var RELEASE_MS = 30000;    // a lane off the page this long is let go
	var CACHE_MAX = 120;       // lanes kept in the session's memory
	var STATES = ['loading', 'ready', 'empty', 'error', 'unavailable'];
	var ELL = String.fromCharCode(0x2026), RSQ = String.fromCharCode(0x2019);
	var BADGE = { anime: 'Anime', season: 'This season', mix: 'YouTube Mix', channel: 'Channel', album: 'Albums', search: 'YouTube search', ext: 'Elsewhere', library: 'Yours', ok: 'Yours', 'new': 'New', cost: 'Uses units' };

	function str(v) { return v == null ? '' : String(v); }
	function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
	function assign(a) {
		for (var i = 1; i < arguments.length; i++) {
			var b = arguments[i];
			if (b) for (var k in b) if (own(b, k)) a[k] = b[k];
		}
		return a;
	}
	function mod(name) {
		var TS = root && root.TrueShuffle;
		if (TS && TS[name]) return TS[name];
		if (inNode && typeof require === 'function') { try { return require('./' + name + '.js'); } catch (e) { return null; } }
		return null;
	}
	function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
	function textOf(v, d) { try { return str(typeof v === 'function' ? v(d) : v); } catch (e) { return ''; } }

	// ---- explain: an error in words for the listener ----------------------------------------

	var NAMES = { animethemes: 'AnimeThemes', anilist: 'AniList', itunes: 'iTunes', lastfm: 'Last.fm', oembed: 'YouTube', youtube: 'YouTube', vndb: 'VNDB', deezer: 'Deezer', lrclib: 'LRCLIB', musicbrainz: 'MusicBrainz' };
	function sourceName(e, opts) {
		if (opts && opts.source) return str(opts.source);
		var host = str(e.host || e.source).trim(), k = host.toLowerCase();
		if (k) {
			if (own(NAMES, k)) return NAMES[k];
			var Src = mod('sources');
			if (Src && Src.HOSTS && own(Src.HOSTS, k) && Src.HOSTS[k].name) return Src.HOSTS[k].name;
			var m = /^https?:\/\/([^/?#]+)/i.exec(host);
			if (m) return m[1];
		}
		return e.name === 'YTError' ? 'YouTube' : '';
	}
	// 'in a minute', 'in about 25 minutes', 'in about 7 hours'
	function inWords(ms) {
		var m = Math.round(ms / 60000);
		if (m <= 1) return 'in a minute';
		if (m < 10) return 'in about ' + m + ' minutes';
		if (m < 55) return 'in about ' + Math.round(m / 5) * 5 + ' minutes';
		var h = Math.round(ms / 3600000);
		return h <= 1 ? 'in about an hour' : 'in about ' + h + ' hours';
	}
	// The hour and minute in California, where Google's day starts again.
	function pacificClock(ms) {
		try {
			var o = {};
			new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
			if (o.hour != null && o.minute != null) return [(+o.hour) % 24, +o.minute];
		} catch (e) { /* no time zones here */ }
		var d = new Date(ms - 8 * 3600000);
		return [d.getUTCHours(), d.getUTCMinutes()];
	}
	function untilPacificMidnight(now) {
		var c = pacificClock(now);
		return Math.max(60000, (24 * 60 - (c[0] * 60 + c[1])) * 60000 - (now % 60000));
	}
	function localClock(ms, tz) {
		try {
			var o = { hour: 'numeric', minute: '2-digit' };
			if (tz) o.timeZone = tz;
			return new Intl.DateTimeFormat('en-US', o).format(new Date(ms)).replace(/\s+/g, ' ');
		} catch (e) { return ''; }
	}
	// 'at midnight Pacific time (2:00 AM your time), in about 7 hours'
	function resetWords(now, opts) {
		var left = untilPacificMidnight(now), local = localClock(now + left, opts && opts.timeZone);
		return 'at midnight Pacific time' + (local && local !== '12:00 AM' ? ' (' + local + ' your time)' : '') + ', ' + inWords(left);
	}
	function waitOf(e, def) { var w = +e.retryMs || +e.waitMs || +e.retryAfterMs || 0; return w > 0 ? w : def; }
	function sentence(s) { s = str(s).trim(); return s && s.length <= 300 ? s : ''; }

	// explain(error, opts) -> { code, text, fix: { label, kind: 'retry' | 'signin' | 'key' | 'settings' } | null, retryMs }
	// Pure. error: a SourceError, a YTError, the resolver's { reason }, lyrics.js's codes, an Error,
	// a string, or { code: 'demo' }. opts: { now (ms), online (false: the device is offline),
	// source (the name to use), noAuto (the lane will not ask again by itself), timeZone }.
	function explain(err, opts) {
		opts = opts || {};
		var now = opts.now != null ? +opts.now : Date.now();
		var e = typeof err === 'string' ? { message: err } : err && typeof err === 'object' ? err : {};
		var yt = e.name === 'YTError';
		var code = str(e.code || e.reason || (e.none ? 'not-found' : '')).toLowerCase();
		var name = sourceName(e, opts), who = name || 'The source', auto = !opts.noAuto;
		var RETRY = { label: 'Try again', kind: 'retry' }, SIGNIN = { label: 'Sign in', kind: 'signin' };
		function out(c, text, fix, extra) { return assign({ code: c, text: text, fix: fix }, extra || null); }
		function again(w) { return auto ? 'It is asked again ' + inWords(w) + '.' : 'Try again ' + inWords(w) + '.'; }
		if (code === 'demo') return out('demo', 'The demo' + RSQ + 's songs are invented, so nothing is asked of other sites here.', null);
		if (code === 'aborted') return out('aborted', 'Stopped.', RETRY);
		if (code === 'offline' || (opts.online === false && /^(|network|timeout|down|server|http)$/.test(code))) {
			return out('offline', (name ? 'This device is offline, so ' + name + ' cannot be asked. ' : 'This device is offline. ') + (auto ? 'This loads again when the connection is back.' : 'Try again when the connection is back.'), RETRY);
		}
		var w;
		switch (code) {
		case 'network': return out('network', who + ' did not answer. Check the connection, then try again.', RETRY);
		case 'timeout': return out('timeout', who + ' took too long to answer. Try again in a moment.', RETRY);
		case 'down': w = waitOf(e, 60000); return out('down', who + ' is not answering. ' + again(w), RETRY, auto ? { retryMs: w } : null);
		case 'rate': case 'busy': w = waitOf(e, name === 'Last.fm' ? 30000 : 60000); return out('rate', who + ' asked for fewer requests. ' + again(w), RETRY, auto ? { retryMs: w } : null);
		case 'server': case 'http': return out('server', who + ' is having trouble answering. Try again later.', RETRY);
		case 'not-found': return out('not-found', yt ? sentence(e.message) || 'YouTube does not know that video or list (it may have been deleted).' : name ? name + ' has nothing for this.' : 'Nothing was found for this.', null);
		case 'bad': case 'bad-answer': case 'bad-request': return out('bad', sentence(e.message) || who + ' did not accept the request.', RETRY);
		case 'auth':
			if (name === 'Last.fm') return e.status == null
				? out('needs-key', 'Last.fm needs an API key of your own (it is free). Add it in Settings.', { label: 'Add a key', kind: 'key' })
				: out('bad-key', 'Last.fm did not accept the API key. Check it in Settings.', { label: 'Check the key', kind: 'key' });
			return out('auth', who + ' refused the request.', null);
		case 'signed-out': return out('signed-out', 'This needs YouTube: sign in, or add an API key in Settings.', SIGNIN);
		case 'needs-key': case 'no-key': return out('needs-key', 'Finding songs on YouTube needs a sign-in or an API key.', SIGNIN);
		case 'quota': return out('quota', 'Today' + RSQ + 's YouTube quota is used up. It starts again ' + resetWords(now, opts) + '.', null, { resetMs: untilPacificMidnight(now) });
		case 'over-budget': return out('over-budget', 'Today' + RSQ + 's YouTube allowance for finding songs is used up. It starts again ' + resetWords(now, opts) + '.', null, { resetMs: untilPacificMidnight(now) });
		case 'needs-search': return out('needs-search', 'This song can only be found with a YouTube search (100 units).', null);
		case 'bad-key': return out('bad-key', 'The YouTube API key is not valid, or not allowed on this website. Check it in Settings.', { label: 'Check the key', kind: 'key' });
		case 'forbidden': return out('forbidden', sentence(e.message) || 'YouTube refused the request.', { label: 'Open Settings', kind: 'settings' });
		case 'config': return out('config', sentence(e.message) || 'Signing in is not set up yet.', { label: 'Open Settings', kind: 'settings' });
		case 'needs-write': case 'denied': case 'state': case 'scope': return out(code, sentence(e.message) || 'The sign-in did not go through.', SIGNIN);
		}
		return out(code || 'error', sentence(e.message) || (name ? name + ' did not answer as expected.' : 'Something went wrong.'), RETRY);
	}

	// ---- The session's memory: lanes by key --------------------------------------------------

	var memory = Object.create(null), order = [];
	function remember(key, data) {
		if (!(key in memory)) order.push(key);
		memory[key] = { data: data, at: Date.now() };
		while (order.length > CACHE_MAX) delete memory[order.shift()];
	}
	function recall(key, maxAge) {
		var m = memory[key];
		return m && !(maxAge > 0 && Date.now() - m.at > maxAge) ? m : null;
	}
	function forget(prefix) {
		if (prefix == null) { memory = Object.create(null); order = []; return; }
		prefix = str(prefix);
		Object.keys(memory).forEach(function (k) { if (k.indexOf(prefix) === 0) delete memory[k]; });
		order = order.filter(function (k) { return k in memory; });
	}

	// ---- The CSS, once -----------------------------------------------------------------------

	var CSS = [
		'.ts-lane { margin: 0 0 6px; container: ts-lane / inline-size; }',
		'.ts-lane-head { align-items: center; row-gap: 6px; }',
		'.ts-lane-head .ts-lane-title { margin: 0; font-size: 21px; color: var(--heading); letter-spacing: -0.01em; }',
		'.ts-lane-head .ts-badge { flex: none; }',
		'.ts-lane-sub { font-size: 13px; color: var(--text-2); min-width: 0; }',
		'.ts-lane-acts { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }',
		'.ts-sec-head .ts-lane-acts .ts-btn { margin-left: 0; }',
		'.ts-lane-all { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 650; color: var(--text-2); text-decoration: none; white-space: nowrap; border-radius: 6px; padding: 4px 2px; }',
		'.ts-lane-all:hover { color: var(--text); text-decoration: underline; }',
		'.ts-lane-all .ts-i { width: 16px; height: 16px; }',
		'.ts-lane-body { min-height: 48px; }',
		'.ts-lane .ts-m-list, .ts-lane-sk { max-width: 980px; }',
		'.ts-lane-msg { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; max-width: 980px; padding: 12px 14px; border: 1px dashed var(--border-strong); border-radius: 12px; color: var(--text-2); font-size: 14px; line-height: 1.45; }',
		'.ts-lane-msg > .ts-i { width: 22px; height: 22px; flex: none; }',
		'.ts-lane-msg p { margin: 0; flex: 1 1 240px; min-width: 0; overflow-wrap: anywhere; }',
		'.ts-lane-msg.is-error { border-style: solid; border-color: var(--kit-warn-line, var(--border-strong)); }',
		'.ts-lane-msg.is-error > .ts-i { color: var(--kit-warn, var(--text-2)); }',
		'.ts-lane-msg.is-empty { border: 0; padding: 6px 8px; }',
		'.ts-lane-btns { display: flex; flex-wrap: wrap; gap: 8px; }',
		'.ts-lane-note { margin: 6px 8px 0; font-size: 12.5px; color: var(--text-2); max-width: 980px; }',
		'.ts-lane-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 6px 0 0; }',
		'.ts-lane-foot:empty { display: none; }',
		'.ts-lane-foot .ts-muted { margin: 0; font-size: 13px; }',
		'.ts-lane-group { margin: 2px 0 10px; }',
		'.ts-lane-gh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 10px 8px 2px; }',
		'.ts-lane-gh .ts-lane-gt { margin: 0; font-size: 15px; font-weight: 700; color: var(--heading); }',
		'.ts-lane-gsub { font-size: 12.5px; color: var(--text-2); }',
		'.ts-lane-group > .ts-btn { margin: 4px 8px 0; }',
		'.ts-lane-cards { margin: 0 -10px; }',
		'.ts-lane-sk { display: block; }',
		'.ts-lane-skrow { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 8px; }',
		'.ts-lane-skart, .ts-lane-skbar, .ts-lane-skpill { display: block; background: var(--border); border-radius: 6px; animation: ts-lane-pulse 1.1s ease-in-out infinite alternate; }',
		'.ts-lane-skart { width: 44px; height: 44px; flex: none; }',
		'.ts-lane-sktext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }',
		'.ts-lane-skbar { height: 10px; }',
		'.ts-lane-skpill { width: 64px; height: 28px; border-radius: 999px; flex: none; }',
		'.ts-lane-skgh { width: 160px; height: 12px; margin: 12px 8px 6px; }',
		'.ts-lane-skcard { padding: 10px; }',
		'.ts-lane-skcard .ts-lane-skart { width: 100%; height: auto; aspect-ratio: 1; margin-bottom: 10px; }',
		'.ts-lane-skcard .ts-lane-skbar { margin-top: 8px; }',
		'@keyframes ts-lane-pulse { from { opacity: 0.45; } to { opacity: 1; } }',
		'@media (prefers-reduced-motion: reduce) { .ts-lane-skart, .ts-lane-skbar, .ts-lane-skpill { animation: none; } }',
		'html.is-reduced .ts-lane-skart, html.is-reduced .ts-lane-skbar, html.is-reduced .ts-lane-skpill { animation: none; }',
		'.ts-lane.is-compact .ts-lane-head { margin: 14px 0 6px; }',
		'.ts-lane.is-compact .ts-lane-head .ts-lane-title { font-size: 15px; }',
		'.ts-lane.is-compact .ts-lane-skrow { height: 48px; }',
		'.ts-lane.is-compact .ts-lane-skart { width: 40px; height: 40px; }',
		'@container ts-lane (max-width: 480px) { .ts-lane-head { margin: 14px 0 6px; } .ts-lane-head .ts-lane-title { font-size: 15px; } .ts-lane-sub { flex-basis: 100%; } .ts-lane-acts { margin-left: 0; flex-basis: 100%; } .ts-lane-skpill { width: 44px; } }',
		'@media (max-width: 760px) { .ts-lane-head .ts-lane-title { font-size: 19px; } .ts-lane-sub { flex-basis: 100%; } .ts-lane-acts { margin-left: 0; flex-basis: 100%; } .ts-lane-cards { margin: 0 -6px; } }'
	].join('\n');
	function css() {
		var doc = root.document;
		if (!doc || !doc.getElementById || doc.getElementById('ts-lanes-css')) return;
		var st = doc.createElement('style');
		st.id = 'ts-lanes-css';
		st.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(st);
	}

	// ---- Watching the page: lanes that leave it stop loading -----------------------------------

	var live = [], watcher = null, onlineBound = false, seq = 0;
	function watch() {
		var MO = root.MutationObserver, doc = root.document;
		if (!MO || !doc || !doc.documentElement) return;
		if (live.length && !watcher) { watcher = new MO(check); watcher.observe(doc.documentElement, { childList: true, subtree: true }); }
		else if (!live.length && watcher) { watcher.disconnect(); watcher = null; }
	}
	function check() {
		var t = Date.now();
		live.slice().forEach(function (lane) {
			var c = !!lane.node.isConnected;
			if (c === lane.connected) { if (!c && lane.goneAt && t - lane.goneAt > RELEASE_MS) release(lane); return; }
			lane.connected = c;
			if (c) attached(lane); else detached(lane);
		});
	}
	function attached(lane) {
		lane.goneAt = 0;
		if (lane.waitLazy) observe(lane);
		else if (lane.again) { lane.again = false; load(lane); }
	}
	function detached(lane) {
		lane.goneAt = Date.now();
		if (lane.ctl || lane.timer) lane.again = true;
		stop(lane);
	}
	// Let go of a lane that left the page a while ago; a reload() takes it back.
	function release(lane) {
		stop(lane);
		live = live.filter(function (l) { return l !== lane; });
		lane.released = true;
		watch();
	}
	function online() {
		live.forEach(function (lane) { if (lane.state === 'error' && !lane.destroyed && lane.node.isConnected) load(lane); });
	}
	function bindOnline() {
		if (onlineBound || !root.addEventListener) return;
		onlineBound = true;
		root.addEventListener('online', online);
	}
	function navOnline() { var n = root.navigator; return !n || n.onLine !== false; }

	// ---- Lazy: within 600 px of the screen ------------------------------------------------------

	function canObserve() { return typeof root.IntersectionObserver === 'function'; }
	// The box that scrolls the lane (the app's main column); null for the window.
	function scrollParent(el) {
		var doc = el.ownerDocument, win = doc && doc.defaultView;
		if (!win || !win.getComputedStyle) return null;
		for (var p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
			var oy = win.getComputedStyle(p).overflowY;
			if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
		}
		return null;
	}
	function observe(lane) {
		if (lane.io || !lane.waitLazy || !lane.node.isConnected) return;
		lane.io = new root.IntersectionObserver(function (entries) {
			if (!entries.some(function (en) { return en.isIntersecting; })) return;
			unobserve(lane);
			lane.waitLazy = false;
			lane.seen = true;
			load(lane);
		}, { root: scrollParent(lane.node), rootMargin: MARGIN + 'px' });
		lane.io.observe(lane.node);
	}
	function unobserve(lane) { if (lane.io) { lane.io.disconnect(); lane.io = null; } }

	// ---- The lane ----------------------------------------------------------------------------------

	function media() { return mod('media'); }
	function limitOf(lane) { var n = +lane.spec.limit; return n > 0 ? Math.floor(n) : Infinity; }
	function hasItems(d) { return !!d && Array.isArray(d.items) && d.items.length > 0; }
	function hasGroups(d) { return !!d && Array.isArray(d.groups) && d.groups.some(function (g) { return g && Array.isArray(g.items) && g.items.length > 0; }); }
	function normalize(raw) {
		if (Array.isArray(raw)) return { items: raw };
		if (raw && typeof raw === 'object') return raw;
		return raw == null ? { items: [] } : { value: raw };
	}
	// Nothing to show: no items and no groups with any. A lane that draws its own body (render)
	// is empty only when its data carries nothing else either ({ items: [] }); a render that
	// draws nothing, or returns false, is empty too.
	var PLAIN = { items: 1, groups: 1, whys: 1, total: 1, more: 1, moreLabel: 1, moreCost: 1, sub: 1 };
	function isEmpty(lane, d) {
		var spec = lane.spec;
		if (typeof spec.isEmpty === 'function') { try { return !!spec.isEmpty(d); } catch (e) { return false; } }
		if (hasItems(d) || hasGroups(d)) return false;
		if (typeof spec.render !== 'function') return true;
		return !Object.keys(d).some(function (k) { var v = d[k]; return !own(PLAIN, k) && v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length); });
	}
	function here() { return root.location ? str(root.location.hash) : ''; }

	function mount(el, ctx, spec) {
		spec = spec || {};
		css();
		var h = ctx.h, id = 'ts-lane-' + (++seq), level = spec.level === 3 || (spec.compact && spec.level !== 2) ? 3 : 2;
		var node = h('section', { class: 'ts-lane' + (spec.compact ? ' is-compact' : ''), data: { lane: spec.id || null, state: 'loading' }, aria: { labelledby: id + '-h', busy: 'true' } });
		var head = h('div', { class: 'ts-sec-head ts-lane-head' });
		var titleEl = h(level === 3 ? 'h3' : 'h2', { class: 'ts-lane-title', id: id + '-h' });
		head.appendChild(titleEl);
		var badge = badgeOf(ctx, spec);
		if (badge) head.appendChild(badge);
		var subEl = h('span', { class: 'ts-lane-sub', hidden: true });
		head.appendChild(subEl);
		var actsEl = h('div', { class: 'ts-lane-acts', hidden: true });
		head.appendChild(actsEl);
		var body = h('div', { class: 'ts-lane-body' });
		var noteEl = h('p', { class: 'ts-lane-note', hidden: true });
		var foot = h('div', { class: 'ts-lane-foot' });
		node.appendChild(head);
		node.appendChild(body);
		node.appendChild(noteEl);
		node.appendChild(foot);
		var lane = {
			spec: spec, ctx: ctx, id: id, level: level, node: node, head: head, titleEl: titleEl, subEl: subEl, actsEl: actsEl, body: body, noteEl: noteEl, foot: foot,
			state: 'loading', data: null, items: null, token: 0, ctl: null, io: null, timer: 0, autoTries: 0, shown: 0,
			destroyed: false, released: false, connected: false, waitLazy: false, again: false, seen: false, goneAt: 0
		};
		lane.api = {
			node: node,
			reload: function () { reload(lane); },
			state: function () { return lane.state; },
			data: function () { return lane.data; },
			destroy: function () { destroy(lane); }
		};
		el.appendChild(node);
		lane.connected = !!node.isConnected;
		live.push(lane);
		watch();
		begin(lane, false);
		return lane.api;
	}
	function badgeOf(ctx, spec) {
		var b = spec.badge;
		if (!b || !ctx.U || !ctx.U.badge) return null;
		var kind = Array.isArray(b) ? b[0] : typeof b === 'object' ? b.kind : b;
		var text = Array.isArray(b) ? b[1] : typeof b === 'object' ? b.text : '';
		kind = str(kind);
		if (!kind) return null;
		return ctx.U.badge(kind, str(text || (kind === 'ext' && spec.source) || (own(BADGE, kind) ? BADGE[kind] : kind)), 'ts-lane-badge');
	}

	// Start (or start again): ask unavailable() first, then the memory, then load (now, or once near).
	function begin(lane, force) {
		stop(lane);
		lane.waitLazy = false;
		lane.again = false;
		var spec = lane.spec, un = null;
		if (typeof spec.unavailable === 'function') {
			try { un = spec.unavailable(); } catch (e) { paintError(lane, e); return; }
		}
		if (un) { paintUnavailable(lane, un); return; }
		var m = !force && spec.key ? recall(str(spec.key), spec.maxAgeMs) : null;
		if (m) { settle(lane, m.data); return; }
		paintLoading(lane);
		if (spec.lazy && !force && !lane.seen && canObserve()) { lane.waitLazy = true; observe(lane); return; }
		load(lane);
	}
	function reload(lane) {
		if (lane.destroyed) return;
		if (lane.released) { lane.released = false; live.push(lane); watch(); }
		lane.connected = !!lane.node.isConnected;
		begin(lane, true);
	}
	// Stop what runs: the load in flight (aborted), a timer, the lazy watch. Answers already on their way are dropped.
	function stop(lane) {
		lane.token++;
		if (lane.ctl) { var c = lane.ctl; lane.ctl = null; try { c.abort(); } catch (e) { /* already over */ } }
		if (lane.timer) { clearTimeout(lane.timer); lane.timer = 0; }
		unobserve(lane);
	}
	function load(lane) {
		stop(lane);
		var spec = lane.spec, token = lane.token;
		var ctl = typeof AbortController === 'function' ? new AbortController() : null;
		lane.ctl = ctl;
		if (lane.state !== 'loading') paintLoading(lane);
		var p;
		try { p = Promise.resolve(typeof spec.load === 'function' ? spec.load(ctl ? ctl.signal : undefined) : null); } catch (e) { p = Promise.reject(e); }
		p.then(function (data) {
			if (!fresh(lane, token)) return;
			lane.ctl = null;
			var d = normalize(data);
			if (spec.key) remember(str(spec.key), d);
			settle(lane, d);
		}, function (err) {
			if (!fresh(lane, token)) return;
			lane.ctl = null;
			paintError(lane, err);
		});
	}
	// Is this answer still wanted? Not for a destroyed lane, a newer load, or a lane off the page
	// (that one loads again if it comes back).
	function fresh(lane, token) {
		if (lane.destroyed || token !== lane.token) return false;
		if (!lane.node.isConnected) { lane.ctl = null; lane.again = true; return false; }
		return true;
	}
	function destroy(lane) {
		if (lane.destroyed) return;
		stop(lane);
		lane.destroyed = true;
		live = live.filter(function (l) { return l !== lane; });
		if (lane.node.parentNode) lane.node.parentNode.removeChild(lane.node);
		watch();
	}

	// ---- Painting each state -------------------------------------------------------------------------

	function setState(lane, s) {
		lane.state = s;
		lane.node.dataset.state = s;
		lane.node.setAttribute('aria-busy', s === 'loading' ? 'true' : 'false');
	}
	function drawHead(lane) {
		var spec = lane.spec, d = lane.state === 'ready' ? lane.data : null, h = lane.ctx.h;
		lane.titleEl.textContent = textOf(spec.title, d);
		var sub = (d && d.sub) || textOf(spec.sub, d);
		lane.subEl.textContent = sub;
		lane.subEl.hidden = !sub;
		clear(lane.actsEl);
		if (d && typeof spec.actions === 'function') {
			var nodes = [];
			try { nodes = (spec.actions(d) || []).filter(Boolean); } catch (e) { nodes = []; }
			nodes.slice(0, 3).forEach(function (n) { lane.actsEl.appendChild(n); });
			if (nodes.length > 3) lane.actsEl.appendChild(moreActions(lane, nodes.slice(3)));
		}
		var all = d && seeAllWanted(lane) ? spec.seeAll : null;
		if (all) {
			var total = +(d && d.total) || 0, label = all.label || ('See all' + (total > countShown(lane) ? ' ' + total.toLocaleString('en-US') : ''));
			var a = h('a', { class: 'ts-lane-all', href: all.href, text: label });
			if (lane.ctx.icon) a.appendChild(lane.ctx.icon('arrow-right'));
			lane.actsEl.appendChild(a);
		}
		lane.actsEl.hidden = !lane.actsEl.firstChild;
	}
	function seeAllWanted(lane) {
		var spec = lane.spec, d = lane.data || {};
		if (!spec.seeAll || !spec.seeAll.href) return false;
		if (spec.seeAll.always || d.more || (+d.total > 0 && +d.total > countShown(lane))) return true;
		return countAll(lane) > countShown(lane);
	}
	function countAll(lane) {
		if (lane.groups) return lane.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
		return lane.items ? lane.items.length : 0;
	}
	function countShown(lane) {
		if (lane.groups) return lane.groups.reduce(function (n, g) { return n + Math.min(g.items.length, g.shown); }, 0);
		return lane.items ? Math.min(lane.items.length, lane.shown) : 0;
	}
	// The header's actions past three, as a menu: each item does what its button did.
	function moreActions(lane, extra) {
		var U = lane.ctx.U;
		var b = U.btn({ icon: 'more', label: 'More actions', iconOnly: true, variant: 'secondary', size: 'sm', menu: true });
		b.addEventListener('click', function () {
			U.openMenu(b, extra.map(function (n) {
				var main = n.classList && n.classList.contains('ts-split') && n.querySelector ? n.querySelector('.ts-split-main') : n;
				var label = (main.dataset && main.dataset.label) || str(main.textContent).trim() || 'Action';
				return { label: label, icon: (main.dataset && main.dataset.icon) || undefined, disabled: !!main.disabled, onSelect: function () { main.click(); } };
			}), { label: 'More actions' });
		});
		return b;
	}
	function msg(lane, cls, iconName, text, buttons) {
		var h = lane.ctx.h, box = h('div', { class: 'ts-lane-msg ' + cls });
		if (iconName && lane.ctx.icon) box.appendChild(lane.ctx.icon(iconName));
		box.appendChild(h('p', { text: text }));
		if (buttons && buttons.length) box.appendChild(h('div', { class: 'ts-lane-btns' }, buttons));
		return box;
	}
	function resetFoot(lane) {
		clear(lane.foot);
		lane.noteEl.textContent = '';
		lane.noteEl.hidden = true;
	}

	function skeleton(lane) {
		var h = lane.ctx.h, spec = lane.spec, n = Math.max(1, Math.min(spec.compact ? 3 : 4, limitOf(lane)));
		var box;
		if (spec.layout === 'cards') {
			box = h('div', { class: (spec.grid ? 'ts-grid is-cards' : 'ts-shelf') + ' ts-lane-sk ts-lane-cards', aria: { hidden: 'true' } });
			for (var c = 0; c < 6; c++) box.appendChild(h('div', { class: 'ts-lane-skcard' }, [h('span', { class: 'ts-lane-skart' }), h('span', { class: 'ts-lane-skbar', style: { width: '80%' } }), h('span', { class: 'ts-lane-skbar', style: { width: '50%' } })]));
			return [box, h('span', { class: 'kit-sr', text: 'Loading' + ELL })];
		}
		box = h('div', { class: 'ts-lane-sk', aria: { hidden: 'true' } });
		if (spec.layout === 'groups') box.appendChild(h('span', { class: 'ts-lane-skbar ts-lane-skgh' }));
		for (var i = 0; i < n; i++) {
			box.appendChild(h('div', { class: 'ts-lane-skrow' }, [
				h('span', { class: 'ts-lane-skart' }),
				h('span', { class: 'ts-lane-sktext' }, [h('span', { class: 'ts-lane-skbar', style: { width: [62, 48, 70, 55][i % 4] + '%' } }), h('span', { class: 'ts-lane-skbar', style: { width: [34, 28, 40, 22][i % 4] + '%' } })]),
				h('span', { class: 'ts-lane-skpill' })
			]));
		}
		return [box, h('span', { class: 'kit-sr', text: 'Loading' + ELL })];
	}
	function paintLoading(lane) {
		setState(lane, 'loading');
		lane.items = null;
		lane.groups = null;
		clear(lane.body);
		resetFoot(lane);
		drawHead(lane);
		skeleton(lane).forEach(function (n) { lane.body.appendChild(n); });
	}
	function settle(lane, d) {
		lane.data = d;
		lane.autoTries = 0;
		lane.items = null;
		lane.groups = null;
		lane.shown = limitOf(lane);
		if (isEmpty(lane, d)) paintEmpty(lane);
		else paintReady(lane);
	}
	function paintEmpty(lane) {
		setState(lane, 'empty');
		lane.items = null;
		lane.groups = null;
		clear(lane.body);
		resetFoot(lane);
		drawHead(lane);
		lane.body.appendChild(msg(lane, 'is-empty', null, textOf(lane.spec.empty, lane.data) || 'Nothing here yet.', []));
		note(lane);
	}
	function note(lane) {
		var n = lane.data && lane.data.note ? str(lane.data.note) : '';
		lane.noteEl.textContent = n;
		lane.noteEl.hidden = !n;
	}
	function paintReady(lane) {
		var spec = lane.spec, d = lane.data, M = media();
		setState(lane, 'ready');
		clear(lane.body);
		resetFoot(lane);
		if (typeof spec.render === 'function') {
			var r;
			try { r = spec.render(lane.body, d); } catch (e) { paintError(lane, e); return; }
			if (r === false) { paintEmpty(lane); return; }
			if (r && r.nodeType && !r.parentNode) lane.body.appendChild(r);
			if (!lane.body.firstChild) { paintEmpty(lane); return; }
		} else if (!M) { paintError(lane, new Error('This part of the page could not load (media.js is missing).')); return; }
		else if ((spec.layout === 'groups' || !hasItems(d)) && hasGroups(d)) drawGroups(lane, M);
		else if (spec.layout === 'cards') drawCards(lane, M);
		else drawRows(lane, M);
		drawHead(lane);
		drawFoot(lane);
		note(lane);
	}
	function errorIcon(code) { return code === 'offline' ? 'wifi-off' : 'info'; }
	function paintError(lane, err) {
		var spec = lane.spec, U = lane.ctx.U;
		var x = explain(err, { now: Date.now(), online: navOnline(), source: spec.source, noAuto: lane.autoTries >= AUTO_TRIES });
		setState(lane, 'error');
		lane.err = err;
		lane.items = null;
		lane.groups = null;
		clear(lane.body);
		resetFoot(lane);
		drawHead(lane);
		var btns = [];
		if (x.fix && x.fix.kind !== 'retry') btns.push(U.btn({ label: x.fix.label, variant: 'secondary', size: 'sm', cls: 'ts-lane-fix', on: { click: function () { runFix(lane, x.fix.kind); } } }));
		btns.push(U.btn({ icon: 'retry', label: 'Try again', variant: btns.length ? 'ghost' : 'secondary', size: 'sm', cls: 'ts-lane-retry', on: { click: function () { reload(lane); } } }));
		lane.body.appendChild(msg(lane, 'is-error', errorIcon(x.code), x.text, btns));
		if (x.code === 'offline') bindOnline();
		if (x.retryMs > 0 && lane.autoTries < AUTO_TRIES) {
			lane.timer = setTimeout(function () {
				lane.timer = 0;
				if (lane.destroyed || lane.state !== 'error' || !lane.node.isConnected) return;
				lane.autoTries++;
				load(lane);
			}, x.retryMs);
		}
	}
	// What the fix button of an error does: the lane's own onFix, the page's ctx.fix, else
	// Sign in (ctx.signIn) or Settings.
	function runFix(lane, kind) {
		var spec = lane.spec, ctx = lane.ctx;
		if (kind === 'retry') { reload(lane); return; }
		if (typeof spec.onFix === 'function' && spec.onFix(kind, lane.api) !== false) return;
		if (typeof ctx.fix === 'function' && ctx.fix(kind) !== false) return;
		if (kind === 'signin' && typeof ctx.signIn === 'function') { ctx.signIn(); return; }
		if (typeof ctx.nav === 'function') ctx.nav('#/settings');
	}
	function paintUnavailable(lane, un) {
		var U = lane.ctx.U;
		setState(lane, 'unavailable');
		lane.items = null;
		lane.groups = null;
		clear(lane.body);
		resetFoot(lane);
		drawHead(lane);
		var btns = [];
		if (un.fix && un.fix.label) {
			btns.push(U.btn({ label: un.fix.label, icon: un.fix.icon || null, variant: 'secondary', size: 'sm', cls: 'ts-lane-fix', on: { click: function () {
				var r = null;
				try { r = typeof un.fix.run === 'function' ? un.fix.run(lane.api) : null; } catch (e) { r = null; }
				// the fix may have made it available (a source switched on): ask again
				Promise.resolve(r).then(function () { if (!lane.destroyed && lane.state === 'unavailable') begin(lane, false); }, function () { /* stays */ });
			} } }));
		}
		lane.body.appendChild(msg(lane, 'is-unavailable', 'info', str(un.text) || 'This is not available here.', btns));
	}

	// ---- The layouts ----------------------------------------------------------------------------------

	// The items as media.js items; `whys` (beside them, one per item) are their reasons.
	function itemsOf(lane, xs, M, whys) {
		return (xs || []).map(function (x, i) {
			var w = whys && whys[i];
			return M.item(w && x && typeof x === 'object' && !(x.t && !x.key) ? { t: x, why: w } : x, lane.ctx);
		}).filter(Boolean);
	}
	function rowOpts(lane) {
		var spec = lane.spec, o = assign({}, spec.row || {});
		if (!o.context) o.context = { label: textOf(spec.title, lane.data) || 'These songs', href: (spec.seeAll && spec.seeAll.href) || here() };
		if (spec.compact) o.compact = true;
		return o;
	}
	function drawRows(lane, M) {
		var items = lane.items = itemsOf(lane, lane.data.items, M, lane.data.whys);
		lane.list = M.list(lane.ctx, items.slice(0, lane.shown), assign(rowOpts(lane), { list: items }));
		lane.body.appendChild(lane.list);
	}
	function drawCards(lane, M) {
		var items = lane.items = itemsOf(lane, lane.data.items, M, lane.data.whys), o = assign(rowOpts(lane), { list: items });
		var box = lane.cards = lane.ctx.h('div', { class: (lane.spec.grid ? 'ts-grid is-cards' : 'ts-shelf') + ' ts-lane-cards' });
		items.slice(0, lane.shown).forEach(function (it) { box.appendChild(M.card(lane.ctx, it, o)); });
		lane.body.appendChild(box);
	}
	function drawGroups(lane, M) {
		var h = lane.ctx.h, o = rowOpts(lane), lim = limitOf(lane), title = textOf(lane.spec.title, lane.data);
		lane.groups = (lane.data.groups || []).filter(function (g) { return g && Array.isArray(g.items) && g.items.length; }).map(function (g) {
			return { title: str(g.title), sub: str(g.sub), items: itemsOf(lane, g.items, M, g.whys), shown: lim, list: null, more: null };
		});
		lane.groups.forEach(function (g, gi) {
			var gid = lane.id + '-g' + gi;
			var box = h('div', { class: 'ts-lane-group', role: 'group', aria: { labelledby: g.title ? gid : null, label: g.title ? null : title } });
			if (g.title || g.sub) {
				var gh = h('div', { class: 'ts-lane-gh' });
				if (g.title) gh.appendChild(h(lane.level === 3 ? 'h4' : 'h3', { class: 'ts-lane-gt', id: gid, text: g.title }));
				if (g.sub) gh.appendChild(h('span', { class: 'ts-lane-gsub', text: g.sub }));
				box.appendChild(gh);
			}
			g.opts = assign({}, o, { list: g.items, context: (lane.spec.row && lane.spec.row.context) || { label: (title ? title + (g.title ? ': ' + g.title : '') : g.title) || 'These songs', href: o.context.href } });
			g.list = M.list(lane.ctx, g.items.slice(0, g.shown), g.opts);
			box.appendChild(g.list);
			if (g.items.length > g.shown) {
				g.more = moreButton(lane, g.items.length - g.shown, function () { showMoreGroup(lane, g, M); });
				box.appendChild(g.more);
			}
			lane.body.appendChild(box);
		});
	}
	function moreButton(lane, rest, fn) {
		var n = Math.min(rest, limitOf(lane));
		return lane.ctx.U.btn({ icon: 'down', label: 'Show ' + n + ' more', variant: 'secondary', size: 'sm', cls: 'ts-lane-more', on: { click: fn } });
	}
	// Show more: the next rows join the list; the focus goes to the first of them.
	function appendRows(lane, M, listEl, items, from, to, opts) {
		var first = null;
		items.slice(from, to).forEach(function (it, i) {
			var r = M.row(lane.ctx, it, assign({}, opts, { index: opts.numbered ? from + i + 1 : opts.index }));
			listEl.appendChild(r);
			if (!first) first = r;
		});
		var b = first && first.querySelector ? first.querySelector('.ts-m-play') : null;
		if (b && b.focus) b.focus();
	}
	function showMoreGroup(lane, g, M) {
		var from = g.shown;
		g.shown = Math.min(g.items.length, g.shown + limitOf(lane));
		appendRows(lane, M, g.list, g.items, from, g.shown, g.opts);
		if (g.more && g.more.parentNode) g.more.parentNode.removeChild(g.more);
		g.more = null;
		if (g.items.length > g.shown) { g.more = moreButton(lane, g.items.length - g.shown, function () { showMoreGroup(lane, g, M); }); g.list.parentNode.appendChild(g.more); }
		drawHead(lane);
	}
	function showMore(lane) {
		var M = media(), from = lane.shown;
		if (!M || !lane.items) return;
		lane.shown = Math.min(lane.items.length, lane.shown + limitOf(lane));
		if (lane.list) appendRows(lane, M, lane.list, lane.items, from, lane.shown, assign(rowOpts(lane), { list: lane.items }));
		else if (lane.cards) {
			var o = assign(rowOpts(lane), { list: lane.items }), first = null;
			lane.items.slice(from, lane.shown).forEach(function (it) { var c = M.card(lane.ctx, it, o); lane.cards.appendChild(c); if (!first) first = c; });
			var a = first && first.querySelector ? first.querySelector('.ts-card-a') : null;
			if (a && a.focus) a.focus();
		}
		drawHead(lane);
		drawFoot(lane);
	}
	// Under the lane: Show more (no See all), and Load more when the data can fetch more.
	function drawFoot(lane) {
		var d = lane.data || {}, U = lane.ctx.U;
		clear(lane.foot);
		if (lane.items && !lane.groups && lane.items.length > lane.shown && !seeAllWanted(lane)) lane.foot.appendChild(moreButton(lane, lane.items.length - lane.shown, function () { showMore(lane); }));
		if (typeof d.more === 'function') {
			var b = U.btn({ icon: 'down', label: d.moreLabel || 'Load more', variant: 'secondary', size: 'sm', cost: +d.moreCost > 0 ? +d.moreCost : null, busyLabel: 'Loading' + ELL, cls: 'ts-lane-load' });
			b.addEventListener('click', function () { loadMore(lane, b); });
			lane.foot.appendChild(b);
		}
	}
	function loadMore(lane, b) {
		var d = lane.data, U = lane.ctx.U, token = lane.token, M = media();
		var ctl = typeof AbortController === 'function' ? new AbortController() : null;
		lane.ctl = ctl;
		U.btnState(b, { busy: true });
		var p;
		try { p = Promise.resolve(d.more(ctl ? ctl.signal : undefined)); } catch (e) { p = Promise.reject(e); }
		p.then(function (more) {
			if (!fresh(lane, token) || lane.data !== d) return;
			lane.ctl = null;
			var m = normalize(more);
			var add = Array.isArray(m.items) ? m.items : [];
			var from = (d.items || []).length;
			d.items = (d.items || []).concat(add);
			d.more = typeof m.more === 'function' ? m.more : m.more || null;
			if (m.total != null) d.total = m.total;
			if (m.note != null) d.note = m.note;
			if (lane.spec.key) remember(str(lane.spec.key), d);
			if (lane.items && M) {
				var fresh2 = itemsOf(lane, add, M);
				lane.items = lane.items.concat(fresh2);
				if (lane.shown >= from) lane.shown = lane.items.length;
				if (lane.list) appendRows(lane, M, lane.list, lane.items, from, lane.shown, assign(rowOpts(lane), { list: lane.items }));
				else if (lane.cards) { var o = assign(rowOpts(lane), { list: lane.items }); fresh2.forEach(function (it) { lane.cards.appendChild(M.card(lane.ctx, it, o)); }); }
			}
			drawHead(lane);
			drawFoot(lane);
			note(lane);
		}, function (err) {
			if (!fresh(lane, token)) return;
			lane.ctl = null;
			U.btnState(b, { busy: false });
			var x = explain(err, { online: navOnline(), source: lane.spec.source, noAuto: true });
			var old = lane.foot.querySelector ? lane.foot.querySelector('.ts-lane-said') : null;
			if (old && old.parentNode) old.parentNode.removeChild(old);
			lane.foot.appendChild(lane.ctx.h('p', { class: 'ts-muted ts-lane-said', text: x.text }));
		});
	}

	return { mount: mount, explain: explain, forget: forget, STATES: STATES, MARGIN: MARGIN };
});
