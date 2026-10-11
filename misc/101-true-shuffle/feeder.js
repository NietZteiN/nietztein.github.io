/*
 * True Shuffle: feeders, what keeps the queue fed. The player's controller
 * asks for more synchronously (onNeedMore); a feeder answers from a buffer
 * of songs that are ready (a library id, or a find that has a YouTube id
 * and a light track in the registry) and fills the buffer in the background.
 * So the queue only ever holds playable ids, and songs still being looked
 * up wait here ("coming up").
 *
 *     var fd = Fd.create(spec, deps);
 *     fd.take(n) -> [ids]          synchronous, from the buffer
 *     fd.fill() -> Promise          keeps `ahead` songs ready
 *     fd.peek(n) -> [{ id, find, status, why }]   what is coming, for the queue panel
 *     fd.feedback(id, 'play' | 'skip' | 'like' | 'unplayable')
 *     fd.status() -> { kind, label, href, phase, buffered, pending, ratio, newShare, taken, searched }
 *     fd.snapshot() -> plain data   Fd.restore(snap, deps) -> feeder   fd.stop()
 *
 * spec: { kind: 'list' | 'radio', label, href, seed (a track id), finds (a list's songs, in
 *         order), ratio (a radio's share of new songs, 0 to 1), ahead (default 3),
 *         allow ('free' | 'cheap' | 'search': what the resolver may spend), searchCap }
 * deps: { resolver, registry (finds.js), providers: { name: function (ctx) -> Promise<[find]> },
 *         familiar(seedId, n, avoid) -> [library ids], track(id) -> track, heard(find),
 *         hidden(find), songKey(track), artistOf(track or find), workOf(track or find),
 *         rand, now, onReady(), onStatus(status), maxWaitMs (8000), askEveryMs (30000) }
 *
 * A list plays in order and ends ('exhausted'); a song that cannot be found
 * is skipped. A radio never ends: each slot is a new song or a familiar one
 * by the ratio (a shortfall is made up later); never the same artist as the
 * last two, the same work as the last one, or a song already played this
 * session; when the queue is waiting, a new song not ready within maxWaitMs
 * gives way to a familiar one (it is kept for later if it arrives); after
 * two unplayable new songs in a row the next song is familiar, so the
 * controller's five-error halt cannot trip.
 *
 * UMD: window.TrueShuffle.feeder in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.feeder = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
	'use strict';

	var RECENT = 40;

	// The next slot of a radio: 'new' while the share of new songs is under the ratio.
	function blend(counts, ratio) {
		ratio = Math.max(0, Math.min(1, +ratio || 0));
		if (ratio <= 0) return 'familiar';
		if (ratio >= 1) return 'new';
		return (counts.fresh || 0) < ratio * ((counts.total || 0) + 1) - 1e-9 ? 'new' : 'familiar';
	}

	function create(spec, deps, snap) {
		spec = spec || {};
		deps = deps || {};
		var kind = spec.kind === 'radio' ? 'radio' : 'list';
		var ahead = spec.ahead > 0 ? spec.ahead : 3;
		var now = deps.now || function () { return Date.now(); };
		var maxWait = deps.maxWaitMs > 0 ? deps.maxWaitMs : 8000;
		var askEvery = deps.askEveryMs >= 0 ? deps.askEveryMs : 30000;
		var buffer = [];                 // [{ id, find, why, from }] ready to play
		var pending = [];                // [{ find, status: 'finding' | 'ready' | 'failed', why, id }] (lists: in order)
		var cursor = 0;                  // lists: the next find to look up
		var candidates = [];             // radios: new songs offered by the providers, not used yet
		var weights = {};                // radios: provider name -> weight
		var counts = { total: 0, fresh: 0 }, badRun = 0, searched = 0, taken = 0, lastAsk = -Infinity;
		var recent = [], given = [], songsPlayed = {}, phase = 'filling', filling = null, stopped = false;
		Object.keys(deps.providers || {}).forEach(function (k) { weights[k] = 1; });
		if (snap) {
			buffer = (snap.buffer || []).slice();
			recent = (snap.recent || []).slice();
			counts = { total: (snap.counts && snap.counts.total) || 0, fresh: (snap.counts && snap.counts.fresh) || 0 };
			searched = snap.searched || 0;
		}

		function track(id) { return id && deps.track ? deps.track(id) : null; }
		function artistOf(x) { return x ? (deps.artistOf ? deps.artistOf(x) : (x.artistKey || x.artist || '')) : ''; }
		function workOf(x) { return x ? (deps.workOf ? deps.workOf(x) : (x.work || '')) : ''; }
		function songOf(t) { return t ? (deps.songKey ? deps.songKey(t) : t.id) : ''; }
		function allowNow() {
			var a = spec.allow || 'free';
			return a === 'search' && spec.searchCap != null && searched >= spec.searchCap ? 'cheap' : a;
		}
		function status() {
			return { kind: kind, label: spec.label || '', href: spec.href || '', phase: phase, buffered: buffer.length, pending: pending.filter(function (p) { return p.status === 'finding'; }).length, ratio: kind === 'radio' ? (+spec.ratio || 0) : null, newShare: counts.total ? counts.fresh / counts.total : 0, taken: taken, searched: searched };
		}
		function tell() { if (deps.onStatus) deps.onStatus(status()); }
		// not the same artist as the last two, nor the same work as the last one
		function fitsAfter(x) {
			var tail = recent.concat(buffer.map(function (b) { return b.id; })).slice(-2);
			var a = artistOf(x), w = workOf(x);
			for (var i = 0; i < tail.length; i++) { var r = track(tail[i]); if (r && a && artistOf(r) === a) return false; }
			if (w && tail.length) { var r1 = track(tail[tail.length - 1]); if (r1 && workOf(r1) === w) return false; }
			return true;
		}
		function played(t) { return !!(t && songsPlayed[songOf(t)]); }
		function register(find, r) {
			var t = track(r.videoId);
			if (!(t && !t.transient) && deps.registry) deps.registry.add(find, r.video || { videoId: r.videoId });
		}

		// ---- lists: in order, a few ahead ----
		function fillList() {
			var finds = spec.finds || [], jobs = [];
			while (buffer.length + pending.length < ahead && cursor < finds.length && !stopped) {
				(function (f) {
					var p = { find: f, status: 'finding', why: f.why || [] };
					pending.push(p);
					jobs.push(Promise.resolve().then(function () { return deps.resolver.resolve(f, { allow: allowNow() }); }).then(function (r) {
						if (r && r.videoId) {
							if (r.rung === 'search') searched++;
							register(f, r);
							p.status = 'ready';
							p.id = r.videoId;
						} else { p.status = 'failed'; p.reason = (r && r.reason) || 'not-found'; }
					}, function (e) { p.status = 'failed'; p.reason = (e && e.code) || 'error'; }));
				})(finds[cursor]);
				cursor++;
			}
			return Promise.all(jobs).then(function () {
				// the order holds: a ready song moves to the buffer only behind earlier ones
				while (pending.length && pending[0].status !== 'finding') {
					var p = pending.shift();
					if (p.status === 'ready') buffer.push({ id: p.id, find: p.find, why: p.why });
				}
				if (!stopped && cursor < finds.length && buffer.length < ahead) return fillList();
			});
		}

		// ---- radios: endless, new and familiar by the ratio ----
		function askProviders() {
			lastAsk = now();
			var names = Object.keys(deps.providers || {});
			return Promise.all(names.map(function (name) {
				var ctx = { seed: spec.seed, recent: recent.slice(), now: now() };
				return Promise.resolve().then(function () { return deps.providers[name](ctx); }).then(function (list) {
					(list || []).forEach(function (f) {
						if (!f || !f.key || (deps.hidden && deps.hidden(f)) || (deps.heard && deps.heard(f))) return;
						if (candidates.some(function (c) { return c.find.key === f.key; })) return;
						candidates.push({ find: f, from: name });
					});
				}, function () { /* a provider that fails gives nothing this time */ });
			}));
		}
		function pickCandidate() {
			var ok = candidates.filter(function (c) { return fitsAfter(c.find); });
			if (!ok.length) return null;
			var total = 0;
			ok.forEach(function (c) { total += weights[c.from] || 1; });
			var r = (deps.rand ? deps.rand() : Math.random()) * total, pick = ok[ok.length - 1];
			for (var i = 0; i < ok.length; i++) { r -= weights[ok[i].from] || 1; if (r <= 0) { pick = ok[i]; break; } }
			candidates = candidates.filter(function (c) { return c !== pick; });
			return pick;
		}
		function familiarOne() {
			var avoid = recent.concat(buffer.map(function (b) { return b.id; }));
			var ids = deps.familiar ? deps.familiar(spec.seed, 24, avoid) || [] : [];
			var free = ids.filter(function (id) { return avoid.indexOf(id) < 0; });
			for (var i = 0; i < free.length; i++) { var t = track(free[i]); if (t && !played(t) && fitsAfter(t)) return free[i]; }
			for (var j = 0; j < free.length; j++) { var t2 = track(free[j]); if (t2 && !played(t2)) return free[j]; }
			return free[0] || null;
		}
		// A new song, ready (resolved and registered), or null.
		function newOne() {
			var started = now();
			function attempt() {
				if (stopped) return Promise.resolve(null);
				var c = pickCandidate();
				if (c) return resolveCandidate(c);
				if (now() - lastAsk < askEvery) return Promise.resolve(null);
				return askProviders().then(function () { var c2 = pickCandidate(); return c2 ? resolveCandidate(c2) : null; });
			}
			function again() { return now() - started < maxWait ? attempt() : Promise.resolve(null); }
			function resolveCandidate(c) {
				var p = { find: c.find, status: 'finding', why: c.find.why || [] };
				pending.push(p);
				function done() { pending = pending.filter(function (x) { return x !== p; }); }
				return Promise.resolve().then(function () { return deps.resolver.resolve(c.find, { allow: allowNow() }); }).then(function (r) {
					done();
					if (!r || !r.videoId) return again();
					if (r.rung === 'search') searched++;
					var t = track(r.videoId);
					if (t && played(t)) return again();
					register(c.find, r);
					return { id: r.videoId, find: c.find, why: c.find.why || [], from: c.from };
				}, function () { done(); return again(); });
			}
			return attempt();
		}
		// When the queue waits on us, a slow new song gives way after maxWait.
		function inTime(p) {
			if (buffer.length) return p;
			var late = false;
			return Promise.race([p.then(function (v) { return v; }), new Promise(function (res) { setTimeout(function () { late = true; res(null); }, maxWait); })]).then(function (v) {
				if (v === null && late) p.then(function (lateOne) { if (lateOne && !stopped) { buffer.push(lateOne); counts.fresh++; counts.total++; } });
				return v;
			});
		}
		function fillRadio() {
			if (buffer.length >= ahead || stopped) return Promise.resolve();
			var slot = badRun >= 2 ? 'familiar' : blend(counts, spec.ratio);
			var step = slot === 'new' ? inTime(newOne()) : Promise.resolve(null);
			return step.then(function (got) {
				// two unplayable new songs since this slot was chosen: a familiar one goes first
				if (got && badRun >= 2) { candidates.unshift({ find: got.find, from: got.from }); got = null; }
				if (got) { buffer.push(got); counts.fresh++; counts.total++; }
				else {
					var id = familiarOne();
					if (!id) return;               // nothing at all: starved
					buffer.push({ id: id, find: null, why: [['familiar', '']] });
					counts.total++;
					if (badRun >= 2) badRun = 0;
				}
				return fillRadio();
			});
		}

		function noteTaken(b) {
			recent.push(b.id);
			if (recent.length > RECENT) recent.shift();
			given.push(b);
			if (given.length > RECENT) given.shift();
			var t = track(b.id);
			if (t) songsPlayed[songOf(t)] = true;
			taken++;
		}
		function from(id) { for (var i = given.length - 1; i >= 0; i--) if (given[i].id === id) return given[i]; return null; }
		// A list with every find taken or given up on: nothing more will come.
		function listDone() { return kind === 'list' && cursor >= (spec.finds || []).length && !pending.length; }

		var api = {
			take: function (n) {
				var out = [];
				while (out.length < (n || 1) && buffer.length) { var b = buffer.shift(); out.push(b.id); noteTaken(b); }
				if (!stopped) api.fill();
				return out;
			},
			fill: function () {
				if (stopped) return Promise.resolve();
				if (filling) return filling;
				// A finished list stays finished (take() asks for a fill each time; that must not hide 'exhausted').
				if (listDone()) { var ph = buffer.length ? 'ready' : 'exhausted'; if (phase !== ph) { phase = ph; tell(); } return Promise.resolve(); }
				phase = 'filling';
				tell();
				filling = (kind === 'list' ? fillList() : fillRadio()).then(function () {
					filling = null;
					phase = buffer.length ? 'ready' : (listDone() ? 'exhausted' : 'starved');
					tell();
					if (buffer.length && deps.onReady) deps.onReady();
				}, function () { filling = null; phase = buffer.length ? 'ready' : 'starved'; tell(); });
				return filling;
			},
			peek: function (n) {
				n = n || 5;
				var out = buffer.map(function (b) { return { id: b.id, find: b.find, status: 'ready', why: b.why }; });
				pending.forEach(function (p) { out.push({ id: p.id || null, find: p.find, status: p.status, why: p.why, reason: p.reason }); });
				if (kind === 'list') (spec.finds || []).slice(cursor, cursor + Math.max(0, n - out.length)).forEach(function (f) { out.push({ id: f.videoId || null, find: f, status: 'waiting', why: f.why || [] }); });
				return out.slice(0, n);
			},
			feedback: function (id, what) {
				if (what === 'unplayable') {
					badRun++;
					if (deps.resolver && deps.resolver.forget) deps.resolver.forget(id);
					// two in a row: the new songs waiting here step back, familiar ones go first
					if (badRun >= 2 && kind === 'radio') {
						var keep = [];
						buffer.forEach(function (b) { if (b.find) candidates.unshift({ find: b.find, from: b.from || 'again' }); else keep.push(b); });
						buffer = keep;
					}
					return;
				}
				if (what === 'play') badRun = 0;
				var b = from(id);
				if (!b || !b.from) return;
				if (what === 'skip') weights[b.from] = Math.max(0.1, (weights[b.from] || 1) * 0.85);
				if (what === 'like') weights[b.from] = Math.min(4, (weights[b.from] || 1) * 1.2);
			},
			status: status,
			snapshot: function () {
				return { v: 1, spec: { kind: kind, label: spec.label || '', href: spec.href || '', seed: spec.seed || null, ratio: spec.ratio || 0, ahead: ahead, allow: spec.allow || 'free', searchCap: spec.searchCap == null ? null : spec.searchCap, finds: (spec.finds || []).slice(cursor) }, buffer: buffer.slice(), recent: recent.slice(), counts: { total: counts.total, fresh: counts.fresh }, searched: searched };
			},
			stop: function () { stopped = true; phase = 'stopped'; tell(); }
		};
		return api;
	}

	// A feeder from a snapshot: the songs that were ready stay ready, a list
	// goes on from where it was.
	function restore(snap, deps) {
		if (!snap || snap.v !== 1 || !snap.spec) return null;
		return create(snap.spec, deps, snap);
	}

	return { create: create, restore: restore, blend: blend };
});
