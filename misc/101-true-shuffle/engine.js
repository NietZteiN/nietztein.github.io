/*
 * True Shuffle: the discovery engine, the one object the page calls about
 * songs the library does not have. It joins the registry and the resolver
 * (finds.js), the feeders (feeder.js), the sources' cache (sources.js) and
 * the page's queue, and it keeps the listener's own discovery data in the
 * store: finds:queue (the light tracks the queue may hold), finds:saved,
 * finds:hidden, finds:heard, feeder (the running feeder, to go on after a
 * reload) and quota:auto (what the engine spent by itself today).
 *
 *     var engine = TS.engine.create(opts);   engine.start() -> Promise
 *     engine.track(id)  engine.find(id)  engine.isFound(id)
 *     engine.play(find | [finds], { mode: 'now' | 'next' | 'later' | 'from', index, label, href }) -> Promise
 *     engine.radio(seedId, { ratio, label, href }) -> Promise     engine.list(finds, opts) -> Promise
 *     engine.feeder() -> status | null   engine.take(n) -> [ids]   engine.peek(n)   engine.stopFeeder()
 *     engine.listened(id, info)  engine.unplayable(id, code)  engine.starved() -> Promise<[ids]>
 *     engine.keep(id) -> [ids]   engine.save(find)  engine.unsave(key)  engine.saved() -> [finds]  engine.isSaved(key)
 *     engine.hide(kind, value) -> undo()   engine.isHidden(find)   engine.hidden()
 *     engine.estimate(finds) -> Promise<estimate>   engine.resolve(find, { allow })
 *     engine.quota() -> { used, daily, reserve, left, auto: { used, cap }, resetsAt }
 *     engine.on('feeder' | 'saved' | 'hidden' | 'quota' | 'library', fn) -> off()   engine.persist()
 *
 * opts: { L, S, M, F, Fd, Src (the modules), lib() (the library, a getter: imports replace it),
 *         store, cache (sources.js createCache), client (yt.js; may be null), canRead() (a key or a
 *         sign-in now), demo, now, rand, quota: { used(), daily() }, reserve (1500), autoCap (300),
 *         pacificDay(now) -> 'YYYY-MM-DD', familiar(seedId, n, avoid) -> [library ids],
 *         index() -> M.index of the library, topicChannels() -> { foldedArtist: channelId },
 *         app: { playNow(ids), queueNext(ids), queueLater(ids), startFeeder(feeder, ids, ctx),
 *                onLibrary(ids, meta), say(text), track(id) }, keepAfterPlays (2) }
 *
 * UMD: window.TrueShuffle.engine in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.engine = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
	'use strict';

	var HEARD_MAX = 3000, SAVED_MAX = 500, DAY = 86400000;

	function create(opts) {
		opts = opts || {};
		var L = opts.L, S = opts.S, M = opts.M, F = opts.F, Fd = opts.Fd;
		var now = opts.now || function () { return Date.now(); };
		var store = opts.store, app = opts.app || {};
		var reserve = opts.reserve == null ? 1500 : opts.reserve, autoCap = opts.autoCap == null ? 300 : opts.autoCap;
		var keepAfter = opts.keepAfterPlays == null ? 2 : opts.keepAfterPlays;
		var reg = null, res = null, feeder = null, started = false;
		var saved = [], hidden = { artist: {}, song: {}, work: {}, channel: {} }, heard = {}, auto = { day: '', units: 0 };
		var subs = {}, persistTimer = 0;

		function emit(name, data) { (subs[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { if (typeof setTimeout === 'function') setTimeout(function () { throw e; }, 0); } }); }
		function lib() { return opts.lib ? opts.lib() : null; }
		function day() { return opts.pacificDay ? opts.pacificDay(now()) : new Date(now()).toISOString().slice(0, 10); }
		function kv(key, value) { if (store && !opts.thumb) return store.set(key, value); return Promise.resolve(); }
		function fold(s) { return M && M.fold ? M.fold(s || '') : String(s || '').toLowerCase(); }

		// ---- quota: today's units, the reserve, what the engine spends by itself ----
		function quota() {
			var used = opts.quota ? +opts.quota.used() || 0 : 0, daily = opts.quota ? +opts.quota.daily() || 10000 : 10000;
			if (auto.day !== day()) auto = { day: day(), units: 0 };
			var left = Math.max(0, daily - used - reserve);
			return { used: used, daily: daily, reserve: reserve, left: left, auto: { used: auto.units, cap: autoCap }, resetsAt: 'midnight Pacific time' };
		}
		var budget = {
			left: function () { return quota().left; },
			autoLeft: function () { var q = quota(); return Math.max(0, Math.min(q.left, autoCap - q.auto.used)); },
			spend: function (units, isAuto) {
				if (auto.day !== day()) auto = { day: day(), units: 0 };
				if (isAuto) { auto.units += units; kv('quota:auto', auto); }
				emit('quota', quota());
			}
		};

		function canRead() { return !opts.demo && !!(opts.canRead && opts.canRead()); }
		function makeResolver() {
			var Src = opts.Src, lists = null;
			if (Src && opts.client) lists = Src.ytLists(opts.client, opts.cache);
			return F.resolver({
				M: M, cache: opts.cache || null, now: now,
				index: function () { return opts.index ? opts.index() : M.index([]); },
				topicChannels: opts.topicChannels || null,
				// What a read really cost, from the client's own count: a cached read costs nothing.
				searchPlaylists: opts.client && opts.client.searchPlaylists ? function (q, o) { return opts.client.searchPlaylists(q, o); } : null,
				lists: lists ? { playlist: function (id, o) { var before = opts.quota ? +opts.quota.used() || 0 : 0; return lists.playlist(id, o).then(function (items) { var out = (items || []).slice(); if (opts.quota) out.units = Math.max(0, (+opts.quota.used() || 0) - before); return out; }); }, uploads: function (ch, o) { var before = opts.quota ? +opts.quota.used() || 0 : 0; return lists.uploads(ch, o).then(function (items) { var out = (items || []).slice(); if (opts.quota) out.units = Math.max(0, (+opts.quota.used() || 0) - before); return out; }); } } : null,
				canList: canRead,
				search: opts.client ? function (q, o) { return opts.client.search(q, o); } : null,
				canSearch: canRead,
				budget: budget
			});
		}
		function track(id) { var l = lib(); return (l && l.tracks[id]) || (reg && reg.get(id)) || null; }

		// ---- persistence ----
		function persist() {
			clearTimeout(persistTimer);
			persistTimer = setTimeout(function () {
				var keep = [];
				if (opts.queueIds) keep = opts.queueIds();
				if (reg) {
					// the registry keeps what the queue holds and what played lately
					var mine = reg.ids(), lately = Object.keys(heard).map(function (k) { return heard[k].id; }).filter(Boolean).slice(-50);
					reg.keepOnly(mine.filter(function (id) { return keep.indexOf(id) >= 0 || lately.indexOf(id) >= 0; }));
					kv('finds:queue', reg.toJSON());
				}
				kv('feeder', feeder ? feeder.snapshot() : null);
			}, 1500);
		}

		// ---- feeders ----
		function feederDeps() {
			return {
				resolver: res, registry: reg, track: track, rand: opts.rand,
				familiar: function (seed, n, avoid) { return opts.familiar ? opts.familiar(seed, n, avoid) : []; },
				songKey: function (t) { return S ? S.songKey(t) : t.id; },
				artistOf: function (x) { return x.artistKey || (S ? S.artistKey(x) : '') || fold(x.artist); },
				workOf: function (x) { return x.work ? fold(x.work) : ''; },
				heard: function (f) { var h = heard[f.key]; return !!(h && now() - h.at < 30 * DAY); },
				hidden: isHidden,
				providers: opts.providers || {},
				onStatus: function (st) { emit('feeder', st); },
				onReady: function () { emit('feeder', feeder ? feeder.status() : null); }
			};
		}
		function startFeeder(fd, ctx) {
			if (feeder) feeder.stop();
			feeder = fd;
			return fd.fill().then(function () {
				if (feeder !== fd) return [];
				var ids = fd.take(3);
				if (app.startFeeder) app.startFeeder(fd, ids, ctx || {});
				persist();
				return ids;
			});
		}

		function isHidden(f) {
			if (!f) return false;
			if (f.artist && hidden.artist[fold(f.artist)]) return true;
			if (f.key && hidden.song[f.key]) return true;
			if (f.work && hidden.work[fold(f.work)]) return true;
			if (f.channelId && hidden.channel[f.channelId]) return true;
			return false;
		}
		function rememberHeard(id, info) {
			var f = reg && reg.find(id);
			if (!f) return;
			var h = heard[f.key] || { id: id, at: 0, plays: 0, skips: 0 };
			h.at = now(); h.id = id;
			if (info && info.completed) h.plays++; else h.skips++;
			heard[f.key] = h;
			var keys = Object.keys(heard);
			if (keys.length > HEARD_MAX) keys.sort(function (a, b) { return heard[a].at - heard[b].at; }).slice(0, keys.length - HEARD_MAX).forEach(function (k) { delete heard[k]; });
			kv('finds:heard', heard);
		}
		function keep(id) {
			if (!reg || !reg.has(id)) return [];
			var changed = F.promote(lib(), reg, id, { L: L, now: now });
			if (changed.length && app.onLibrary) app.onLibrary(changed, true);
			emit('library', changed);
			persist();
			return changed;
		}

		var engine = {
			start: function () {
				var gets = ['finds:queue', 'finds:saved', 'finds:hidden', 'finds:heard', 'feeder', 'quota:auto'].map(function (k) { return store && !opts.thumb ? store.get(k, null) : Promise.resolve(null); });
				return Promise.all(gets).then(function (r) {
					reg = r[0] ? F.registryFrom(lib(), r[0], { L: L, now: now }) : F.registry(lib(), { L: L, now: now });
					saved = Array.isArray(r[1]) ? r[1] : [];
					if (r[2] && typeof r[2] === 'object') ['artist', 'song', 'work', 'channel'].forEach(function (k) { hidden[k] = r[2][k] || {}; });
					heard = r[3] && typeof r[3] === 'object' ? r[3] : {};
					if (r[5] && r[5].day) auto = r[5];
					res = makeResolver();
					started = true;
					if (r[4] && r[4].v === 1) feeder = Fd.restore(r[4], feederDeps());
					return engine;
				});
			},
			// A new library (an import, a restore): the registry reads names the new way.
			relink: function () { if (!reg) return; var json = reg.toJSON(); reg = F.registryFrom(lib(), json, { L: L, now: now }); res = makeResolver(); },
			track: function (id) { return reg ? reg.get(id) : null; },
			find: function (id) { return reg ? reg.find(id) : null; },
			isFound: function (id) { return !!(reg && reg.has(id)); },
			// Play finds: one now (it plays at once, what was coming stays), next or later;
			// or a list of them from one place on ('from', a list feeder).
			play: function (input, o) {
				o = o || {};
				var finds = Array.isArray(input) ? input : [input];
				var mode = o.mode || 'now';
				if (mode === 'from') return engine.list(finds.slice(o.index || 0), o);
				var f = finds[0];
				return res.resolve(f, { allow: 'search' }).then(function (r) {
					if (!r || !r.videoId) return r;
					var t = track(r.videoId);
					if (!(t && !t.transient)) reg.add(f, r.video || { videoId: r.videoId });
					persist();
					var ids = [r.videoId];
					if (mode === 'next') app.queueNext(ids); else if (mode === 'later') app.queueLater(ids); else app.playNow(ids);
					return r;
				});
			},
			// A list of finds in order, looked up a few ahead (a lane, an album, Saved for later).
			list: function (finds, o) {
				o = o || {};
				var fd = Fd.create({ kind: 'list', label: o.label || 'Found songs', href: o.href || '', finds: finds, ahead: 3, allow: 'search', searchCap: o.searchCap == null ? 10 : o.searchCap }, feederDeps());
				return startFeeder(fd, { label: o.label, href: o.href });
			},
			// An endless radio from a song: familiar songs, and new ones by the ratio.
			radio: function (seedId, o) {
				o = o || {};
				var fd = Fd.create({ kind: 'radio', seed: seedId, ratio: o.ratio == null ? 0.5 : o.ratio, label: o.label || 'Radio', href: o.href || '', ahead: 3, allow: o.allow || 'cheap', searchCap: 0 }, feederDeps());
				return startFeeder(fd, { label: o.label, href: o.href, radio: true });
			},
			feeder: function () { return feeder ? feeder.status() : null; },
			take: function (n) { if (!feeder) return []; var ids = feeder.take(n); persist(); return ids; },
			peek: function (n) { return feeder ? feeder.peek(n) : []; },
			stopFeeder: function () { if (feeder) { feeder.stop(); feeder = null; persist(); emit('feeder', null); } },
			// The queue ran dry with a feeder on: more as soon as it has them.
			starved: function () {
				if (!feeder) return Promise.resolve([]);
				var fd = feeder;
				return fd.fill().then(function () { return feeder === fd ? fd.take(3) : []; });
			},
			listened: function (id, info) {
				if (!reg || !reg.has(id)) return null;
				var t = reg.listened(id, info);
				if (info && info.durationSec) reg.setDuration(id, info.durationSec);
				rememberHeard(id, info);
				if (feeder) feeder.feedback(id, info && info.completed ? 'play' : 'skip');
				if (t && keepAfter > 0 && t.plays >= keepAfter) keep(id);
				persist();
				return t;
			},
			unplayable: function (id) {
				if (res) res.forget(id);
				if (feeder) feeder.feedback(id, 'unplayable');
			},
			keep: keep,
			save: function (f) {
				if (!f || !f.key || engine.isSaved(f.key)) return;
				var c = JSON.parse(JSON.stringify(f));
				c.savedAt = now();
				saved.unshift(c);
				if (saved.length > SAVED_MAX) saved.length = SAVED_MAX;
				kv('finds:saved', saved);
				emit('saved', saved.slice());
			},
			unsave: function (key) { saved = saved.filter(function (f) { return f.key !== key; }); kv('finds:saved', saved); emit('saved', saved.slice()); },
			saved: function () { return saved.slice(); },
			isSaved: function (key) { return saved.some(function (f) { return f.key === key; }); },
			// kind: 'artist' (a name), 'song' (a find key), 'work' (a name), 'channel' (an id). -> undo()
			hide: function (kind, value) {
				if (!hidden[kind] || !value) return function () {};
				var k = kind === 'artist' || kind === 'work' ? fold(value) : value;
				hidden[kind][k] = now();
				kv('finds:hidden', hidden);
				emit('hidden', hidden);
				return function () { delete hidden[kind][k]; kv('finds:hidden', hidden); emit('hidden', hidden); };
			},
			isHidden: isHidden,
			hidden: function () { return JSON.parse(JSON.stringify(hidden)); },
			// An album or another group: its own YouTube list looked up once (finds.js resolveGroup).
			resolveGroup: function (finds, o) { return res.prepare(finds).then(function () { return res.resolveGroup(finds, o); }); },
			estimate: function (finds) { return res.prepare(finds).then(function () { return res.estimate(finds); }); },
			resolve: function (f, o) { return res.resolve(f, o || { allow: 'free' }); },
			quota: quota,
			on: function (name, fn) { (subs[name] || (subs[name] = [])).push(fn); return function () { subs[name] = (subs[name] || []).filter(function (x) { return x !== fn; }); }; },
			persist: persist,
			started: function () { return started; }
		};
		return engine;
	}

	return { create: create };
});
