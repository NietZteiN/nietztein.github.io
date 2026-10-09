/*
 * True Shuffle: the player. One interface, two implementations, and the
 * controller that walks a queue with either.
 *
 *     var p = TrueShuffle.player.create({ kind: 'youtube', container: el });
 *     var p = TrueShuffle.player.create({ kind: 'mock', durationOf: fn });
 *
 *     p.on('ready' | 'playing' | 'paused' | 'ended' | 'error' | 'time' | 'state', fn) -> off()
 *     p.load(id, { autoplay, startSec })   p.play()   p.pause()   p.stop()   p.seek(sec)
 *     p.time() -> { current, duration }    p.state()  p.id()      p.destroy()
 *     p.listened() -> seconds of the loaded track really heard (seeking over a part does not count)
 *
 * 'youtube' is the YouTube IFrame Player. Nothing of YouTube's is fetched
 * until load() is first called: then https://www.youtube.com/iframe_api is
 * added to the page and the player is built inside `container`. YouTube's
 * terms require the player to be visible, at least 200 by 200 pixels, with its
 * own controls: this file refuses to build it in a smaller or hidden box,
 * never hides it, and never switches the controls off. The page must not
 * cover it or move it off screen either.
 *
 * 'mock' plays nothing. It advances a clock (by itself, or when tick() is
 * called), fires the same events, and fails on the ids it is told to fail on.
 * The demo and the tests use it.
 *
 * controller() joins a player to the queue reducer of shuffle.js: when a
 * track ends the next one starts; when YouTube reports error 100 (removed or
 * private), 101 or 150 (embedding not allowed) the track is reported through
 * onUnplayable and skipped.
 *
 * UMD: window.TrueShuffle.player in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, function () { return node ? require('./shuffle.js') : (root.TrueShuffle || {}).shuffle; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.player = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getShuffle) {
	'use strict';

	var IFRAME_API = 'https://www.youtube.com/iframe_api';
	var MIN_SIZE = 200;                       // YouTube's minimum player size, in CSS pixels
	var UNPLAYABLE = { 100: 'removed', 101: 'embedding', 150: 'embedding' };
	var ERROR_TEXT = {
		2: 'YouTube did not accept this video id.',
		5: 'The video cannot be played in this browser.',
		100: 'The video was removed or is private.',
		101: 'The owner does not allow this video to be played on other sites.',
		150: 'The owner does not allow this video to be played on other sites.',
		'too-small': 'The player needs a visible box of at least 200 by 200 pixels.',
		'api': 'The YouTube player could not be loaded.'
	};

	function emitter() {
		var subs = {};
		return {
			on: function (name, fn) {
				(subs[name] || (subs[name] = [])).push(fn);
				return function () { subs[name] = (subs[name] || []).filter(function (f) { return f !== fn; }); };
			},
			emit: function (name, data) {
				(subs[name] || []).slice().forEach(function (fn) { fn(data); });
			},
			clear: function () { subs = {}; }
		};
	}

	// ---- The mock ------------------------------------------------------------------

	// opts: { durationOf(id) -> seconds (default 180), errorOf(id) -> a YouTube
	// error code or nothing, auto (advance by itself, default true in a
	// browser), speed (clock seconds per real second, default 1), stepMs,
	// container + titleOf(id) (draws a plain card with a progress bar) }
	// Extra: tick(ms) advances the clock by hand; finish() jumps to the end.
	function createMock(opts) {
		opts = opts || {};
		var ev = emitter(), state = 'idle', id = null, current = 0, duration = 0, heard = 0, timer = null, destroyed = false, pending = null;
		var auto = opts.auto == null ? typeof root.document !== 'undefined' : !!opts.auto;
		var speed = opts.speed > 0 ? opts.speed : 1, stepMs = opts.stepMs > 0 ? opts.stepMs : 250;
		var card = null, bar = null, label = null, clock = null;

		function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
		function draw() {
			if (!opts.container || !root.document) return;
			if (!card) {
				card = root.document.createElement('div');
				card.className = 'ts-mock';
				card.setAttribute('role', 'group');
				card.setAttribute('aria-label', 'Demo player (no sound)');
				label = root.document.createElement('p'); label.className = 'ts-mock-title';
				bar = root.document.createElement('progress'); bar.className = 'ts-mock-bar'; bar.max = 1; bar.value = 0;
				clock = root.document.createElement('p'); clock.className = 'ts-mock-time';
				card.appendChild(label); card.appendChild(bar); card.appendChild(clock);
				opts.container.appendChild(card);
			}
			label.textContent = id == null ? 'Nothing loaded' : (opts.titleOf ? String(opts.titleOf(id)) : String(id));
			bar.value = duration > 0 ? Math.min(1, current / duration) : 0;
			clock.textContent = fmt(current) + ' / ' + fmt(duration) + (state === 'paused' ? ' (paused)' : state === 'error' ? ' (cannot play)' : '');
		}
		function set(s) { if (state !== s) { state = s; ev.emit('state', { id: id, state: s }); } draw(); }
		function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
		function startTimer() {
			if (!auto || timer || destroyed) return;
			var last = Date.now();
			timer = setInterval(function () { var now = Date.now(); advance((now - last) * speed); last = now; }, stepMs);
		}
		function advance(ms) {
			if (state !== 'playing' || destroyed) return;
			var was = current;
			current = Math.min(duration, current + ms / 1000);
			heard += current - was;
			ev.emit('time', { id: id, current: current, duration: duration });
			if (current >= duration) { stopTimer(); set('ended'); ev.emit('ended', { id: id }); }
			else draw();
		}
		var api = {
			kind: 'mock',
			on: ev.on,
			load: function (videoId, o) {
				o = o || {};
				stopTimer();
				id = videoId;
				heard = 0;
				current = Math.max(0, +o.startSec || 0);
				duration = Math.max(1, +(opts.durationOf && opts.durationOf(videoId)) || 180);
				var code = opts.errorOf && opts.errorOf(videoId);
				var token = pending = {};
				set('loading');
				// Like the real player, the answer comes later, not inside load().
				return Promise.resolve().then(function () {
					if (destroyed || pending !== token) return;
					if (code) { set('error'); ev.emit('error', { id: videoId, code: code, message: ERROR_TEXT[code] || 'The video cannot be played.' }); return; }
					if (o.autoplay === false) { set('paused'); ev.emit('paused', { id: videoId }); return; }
					set('playing'); ev.emit('playing', { id: videoId }); startTimer();
				});
			},
			play: function () { if (id == null || state === 'error' || state === 'playing' || state === 'loading') return; if (state === 'ended') current = 0; set('playing'); ev.emit('playing', { id: id }); startTimer(); },
			pause: function () { if (state !== 'playing') return; stopTimer(); set('paused'); ev.emit('paused', { id: id }); },
			stop: function () { stopTimer(); pending = null; id = null; current = 0; duration = 0; set('idle'); },
			seek: function (sec) { if (id == null) return; current = Math.max(0, Math.min(duration, +sec || 0)); ev.emit('time', { id: id, current: current, duration: duration }); draw(); },
			time: function () { return { current: current, duration: duration }; },
			listened: function () { return heard; },
			state: function () { return state; },
			id: function () { return id; },
			tick: function (ms) { advance(ms == null ? stepMs : ms); },
			finish: function () { advance((duration - current) * 1000 + 1); },
			destroy: function () { destroyed = true; stopTimer(); ev.clear(); if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
		};
		Promise.resolve().then(function () { if (!destroyed) ev.emit('ready', {}); });
		draw();
		return api;
	}

	// ---- The YouTube IFrame player ----------------------------------------------------

	var apiPromise = null;
	// Add YouTube's IFrame API script to the page, once. Called by the first
	// load(); nothing calls it earlier.
	function loadIframeApi(timeoutMs) {
		if (apiPromise) return apiPromise;
		apiPromise = new Promise(function (resolve, reject) {
			var doc = root.document;
			if (!doc) { reject(new Error('No document.')); return; }
			if (root.YT && root.YT.Player) { resolve(root.YT); return; }
			var done = false, earlier = root.onYouTubeIframeAPIReady;
			var timer = setTimeout(function () { finish(new Error('timeout')); }, timeoutMs || 15000);
			function finish(err) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				if (err) { apiPromise = null; reject(err); } else resolve(root.YT);
			}
			root.onYouTubeIframeAPIReady = function () {
				if (typeof earlier === 'function') { try { earlier(); } catch (e) { /* not ours */ } }
				finish(null);
			};
			var s = doc.createElement('script');
			s.src = IFRAME_API;
			s.async = true;
			s.onerror = function () { finish(new Error('network')); };
			doc.head.appendChild(s);
		});
		return apiPromise;
	}

	function visibleBox(el) {
		if (!el || !el.getBoundingClientRect) return null;
		var r = el.getBoundingClientRect(), cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
		if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0)) return null;
		return { width: r.width, height: r.height };
	}

	// opts: { container (an element at least 200 by 200 px, visible),
	//         host (default 'https://www.youtube-nocookie.com'), timeoutMs }
	function createYouTube(opts) {
		opts = opts || {};
		var ev = emitter(), state = 'idle', id = null, yt = null, building = null, poll = null, destroyed = false, wanted = null, heard = 0, lastSeen = null;
		var host = opts.host || 'https://www.youtube-nocookie.com';

		function set(s) { if (state !== s) { state = s; ev.emit('state', { id: id, state: s }); } }
		function fail(code, message, detail) { set('error'); ev.emit('error', { id: id, code: code, message: message || ERROR_TEXT[code] || 'The video cannot be played.', detail: detail || '' }); }
		function stopPoll() { if (poll) { clearInterval(poll); poll = null; } lastSeen = null; }
		function startPoll() {
			if (poll) return;
			poll = setInterval(function () {
				if (!yt || !yt.getCurrentTime) return;
				var at = yt.getCurrentTime() || 0;
				// Seconds really heard: small steps forward count, jumps (a seek) do not.
				if (lastSeen != null && at > lastSeen && at - lastSeen <= 2) heard += at - lastSeen;
				lastSeen = at;
				ev.emit('time', { id: id, current: at, duration: yt.getDuration() || 0 });
			}, 500);
		}
		function onState(e) {
			var S = root.YT.PlayerState;
			if (e.data === S.PLAYING) { set('playing'); ev.emit('playing', { id: id }); startPoll(); }
			else if (e.data === S.PAUSED) { stopPoll(); set('paused'); ev.emit('paused', { id: id }); }
			else if (e.data === S.ENDED) { stopPoll(); set('ended'); ev.emit('ended', { id: id }); }
			else if (e.data === S.BUFFERING) set('loading');
			else if (e.data === S.CUED) set('paused');
		}
		// The box is measured when the player is built. A page that has just
		// shown it gets two frames for its layout before the size is refused.
		function measured() {
			var box = visibleBox(opts.container);
			if (box && box.width >= MIN_SIZE && box.height >= MIN_SIZE) return Promise.resolve(box);
			var raf = root.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
			return new Promise(function (r) { raf(function () { raf(r); }); }).then(function () {
				var b2 = visibleBox(opts.container);
				if (b2 && b2.width >= MIN_SIZE && b2.height >= MIN_SIZE) return b2;
				var err = new Error(ERROR_TEXT['too-small']);
				err.code = 'too-small';
				err.detail = b2 ? 'box ' + Math.round(b2.width) + 'x' + Math.round(b2.height) : 'box hidden';
				throw err;
			});
		}
		function build(videoId, o) {
			return measured().then(function () { return loadIframeApi(opts.timeoutMs); }, function (err) { err.sized = true; throw err; }).then(function (YT) {
				if (destroyed) return null;
				return new Promise(function (resolve) {
					var mount = root.document.createElement('div');
					opts.container.appendChild(mount);
					yt = new YT.Player(mount, {
						width: '100%',
						height: '100%',
						host: host,
						videoId: videoId,
						// YouTube's own controls stay on (controls is left at its
						// default). playsinline keeps phones from going full screen.
						playerVars: { autoplay: o.autoplay === false ? 0 : 1, playsinline: 1, rel: 0, start: Math.floor(+o.startSec || 0) || undefined, origin: root.location ? root.location.origin : undefined },
						events: {
							onReady: function () { ev.emit('ready', {}); resolve(yt); },
							onStateChange: onState,
							onError: function (e) { stopPoll(); fail(e.data); }
						}
					});
				});
			}, function (e) {
				if (e && e.sized) throw e;
				var err = new Error(ERROR_TEXT.api);
				err.code = 'api';
				err.detail = 'script ' + (e && e.message);
				throw err;
			});
		}
		var api = {
			kind: 'youtube',
			on: ev.on,
			// Resolves once the player has been given the video; what happens
			// then arrives as events. Rejects (and fires 'error' with code
			// 'too-small' or 'api') if the player could not be built.
			load: function (videoId, o) {
				o = o || {};
				id = videoId;
				wanted = { id: videoId, o: o };
				heard = 0;
				stopPoll();
				set('loading');
				if (yt && yt.loadVideoById) {
					if (o.autoplay === false) yt.cueVideoById({ videoId: videoId, startSeconds: +o.startSec || 0 });
					else yt.loadVideoById({ videoId: videoId, startSeconds: +o.startSec || 0 });
					return Promise.resolve();
				}
				if (!building) {
					building = build(videoId, o).then(function (player) {
						// A newer load() may have come in while the player was built.
						if (player && wanted && wanted.id !== videoId) api.load(wanted.id, wanted.o);
					}, function (err) {
						building = null;
						fail(err.code || 'api', err.message, err.detail);
						throw err;
					});
				}
				return building;
			},
			play: function () { if (yt && yt.playVideo) yt.playVideo(); },
			pause: function () { if (yt && yt.pauseVideo) yt.pauseVideo(); },
			stop: function () { stopPoll(); if (yt && yt.stopVideo) yt.stopVideo(); id = null; wanted = null; set('idle'); },
			seek: function (sec) { if (yt && yt.seekTo) yt.seekTo(+sec || 0, true); },
			time: function () { return { current: yt && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0, duration: yt && yt.getDuration ? yt.getDuration() || 0 : 0 }; },
			listened: function () { return heard; },
			state: function () { return state; },
			id: function () { return id; },
			destroy: function () { destroyed = true; stopPoll(); ev.clear(); if (yt && yt.destroy) { try { yt.destroy(); } catch (e) { /* gone already */ } } yt = null; }
		};
		return api;
	}

	function create(opts) {
		opts = opts || {};
		if (opts.kind === 'youtube') return createYouTube(opts);
		if (opts.kind === 'mock') return createMock(opts);
		throw new Error('player.create: kind must be "youtube" or "mock".');
	}

	// ---- The controller ------------------------------------------------------------------

	// Walk a queue with a player.
	//   opts.player          a player from create()
	//   opts.state           a queue state to start from (default: empty)
	//   opts.onChange(state, why)    the queue changed ('load', 'next', 'ended', 'skip', ...)
	//   opts.onListened(id, info)    a track was left: { completed, listenedSec, durationSec, at }
	//                                (library.recordPlay takes exactly this)
	//   opts.onUnplayable(id, code)  YouTube refused the track (100, 101, 150); it is skipped
	//   opts.onError(id, code, message, detail)   any other failure (detail: for 'api' and 'too-small', what went wrong)
	//   opts.onNeedMore(state)       the queue is about to run out; return ids to add
	//                                (how an endless true shuffle draws from its bag)
	//   opts.onHalt(reason)          playback stopped by itself: 'finished', 'errors', 'player'
	//   opts.now()                   the clock (default Date.now)
	//   opts.maxErrors               consecutive failed tracks before giving up (default 5)
	// Methods: load(ids, index), next(), previous(), jump(index), playNext(ids),
	// enqueue(ids), remove(indexOrId), move(from, to), clearUpcoming(),
	// setRepeat(bool), pause(), resume(), toggle(), state(), current(), destroy().
	function controller(opts) {
		opts = opts || {};
		var Shuffle = getShuffle();
		var player = opts.player, reduce = opts.reduce || Shuffle.queue;
		var state = opts.state || Shuffle.queueInit();
		var now = opts.now || function () { return Date.now(); };
		var maxErrors = opts.maxErrors > 0 ? opts.maxErrors : 5;
		var playingId = null, lastDuration = 0, errorsInARow = 0, offs = [], dead = false;

		function cur(s) { return s.index >= 0 && s.index < s.items.length ? s.items[s.index] : null; }
		function call(fn, a, b, c, d) { if (typeof fn === 'function') { try { return fn(a, b, c, d); } catch (e) { if (root.setTimeout) root.setTimeout(function () { throw e; }, 0); } } return undefined; }

		// The track that was playing is left: report how much of it was heard.
		function leave(completed) {
			if (playingId == null) return;
			var id = playingId;
			playingId = null;
			call(opts.onListened, id, { completed: !!completed, listenedSec: Math.round(player.listened()), durationSec: Math.round(lastDuration), at: now() });
		}
		function start(id) {
			lastDuration = 0;
			playingId = id;
			var p = player.load(id, { autoplay: true });
			if (p && p.catch) p.catch(function () { /* reported through the 'error' event */ });
		}
		// Apply an action; if the current track changed, switch the player.
		function dispatch(action, why, completed) {
			if (dead) return state;
			var before = cur(state), next = reduce(state, action);
			if (next === state) return state;
			state = next;
			refill();
			var after = cur(state);
			// A track that ended and is current again (repeat with one track)
			// starts again.
			if (after !== before || action.type === 'load' || action.type === 'jump' || (completed && after != null)) {
				leave(completed);
				if (after != null) start(after);
				else { player.stop(); if (state.done) call(opts.onHalt, 'finished'); }
			}
			call(opts.onChange, state, why || action.type);
			return state;
		}
		// With two tracks or fewer left, ask for more before the queue runs dry.
		function refill() {
			if (!opts.onNeedMore) return;
			if (cur(state) == null && !state.done) return;
			if (state.items.length - state.index > 2) return;
			var more = call(opts.onNeedMore, state);
			if (more && more.length) state = reduce(state, { type: 'enqueue', ids: more });
		}

		offs.push(player.on('time', function (e) {
			if (e.id === playingId && e.duration) lastDuration = e.duration;
		}));
		offs.push(player.on('playing', function () { errorsInARow = 0; }));
		offs.push(player.on('ended', function (e) {
			if (e.id !== playingId) return;
			dispatch({ type: 'next' }, 'ended', true);
		}));
		offs.push(player.on('error', function (e) {
			if (e.id !== playingId && e.id != null) return;
			var id = playingId;
			playingId = null;            // a track that never played is neither a play nor a skip
			if (UNPLAYABLE[e.code]) call(opts.onUnplayable, id, e.code);
			else call(opts.onError, id, e.code, e.message, e.detail);
			if (e.code === 'api' || e.code === 'too-small') { call(opts.onHalt, 'player'); return; }
			if (++errorsInARow >= maxErrors) { call(opts.onHalt, 'errors'); return; }
			dispatch({ type: 'next' }, 'skip', false);
		}));

		return {
			load: function (ids, index) { return dispatch({ type: 'load', ids: ids, index: index }, 'load'); },
			next: function () { return dispatch({ type: 'next' }, 'next'); },
			previous: function () { return dispatch({ type: 'previous' }, 'previous'); },
			jump: function (index) { return dispatch({ type: 'jump', index: index }, 'jump'); },
			playNext: function (ids) { return dispatch({ type: 'playNext', ids: [].concat(ids) }, 'playNext'); },
			enqueue: function (ids) { return dispatch({ type: 'enqueue', ids: [].concat(ids) }, 'enqueue'); },
			remove: function (what) { return dispatch(typeof what === 'number' ? { type: 'remove', index: what } : { type: 'remove', id: what }, 'remove'); },
			move: function (from, to) { return dispatch({ type: 'move', from: from, to: to }, 'move'); },
			clearUpcoming: function () { return dispatch({ type: 'clearUpcoming' }, 'clearUpcoming'); },
			setRepeat: function (value) { return dispatch({ type: 'setRepeat', value: value }, 'setRepeat'); },
			pause: function () { player.pause(); },
			resume: function () {
				// After a reload the queue is restored but nothing is loaded yet.
				if (playingId == null && cur(state) != null) { errorsInARow = 0; start(cur(state)); }
				else player.play();
			},
			toggle: function () { if (player.state() === 'playing') player.pause(); else this.resume(); },
			state: function () { return state; },
			current: function () { return cur(state); },
			destroy: function () { dead = true; leave(false); offs.forEach(function (off) { off(); }); offs = []; }
		};
	}

	return {
		create: create,
		controller: controller,
		loadIframeApi: loadIframeApi,
		IFRAME_API: IFRAME_API,
		MIN_SIZE: MIN_SIZE,
		UNPLAYABLE: UNPLAYABLE,
		ERROR_TEXT: ERROR_TEXT
	};
});
