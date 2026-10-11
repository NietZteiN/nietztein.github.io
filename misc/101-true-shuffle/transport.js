/*
 * True Shuffle: the transport, what the operating system sees of the player.
 * It owns the Media Session (the title, artist and artwork a phone's lock
 * screen, a car's display or the PC's media overlay show, and the play,
 * pause, next and previous buttons) and the media-key anchor.
 *
 *     var tr = TrueShuffle.transport.create({ onPlay, onPause, onNext, onPrev, onSeek, onSeekBy, onLog, mobile, enabled, now });
 *     tr.mirror(state)        the player's state: 'playing' 'loading' 'paused' 'ended' 'idle' 'error'
 *     tr.wake()               from a click: start the anchor while the browser allows sound
 *     tr.metadata({ title, artist, album, artwork })   tr.position({ duration, position })
 *     tr.enable(bool)  tr.enabled()  tr.anchorState()  tr.log()  tr.fire(action, details)  tr.destroy()
 *
 * Why an anchor. Chromium routes media keys and Bluetooth buttons only to a
 * frame that has a media player of its own, the shallowest such frame
 * (MediaSessionImpl::ComputeFrameForRouting, read on 2026-10-10). The only
 * player on this page is YouTube's cross-origin iframe, so without one of
 * ours the page's handlers never hear next or previous: the keyboard's keys
 * and a car's steering-wheel buttons go to YouTube's frame, which has no
 * queue. The anchor is a looping <audio> element of digital silence, built in
 * memory (no request), never muted (a muted element is not a player to route
 * to), that plays while YouTube's player plays and pauses with it. The page
 * then has a player nearer the top than YouTube's, and the buttons come here.
 *
 * It never keeps sound going on its own: it only mirrors the YouTube player,
 * and on a phone it pauses the moment the page is hidden and ignores play,
 * next, previous and seeking while hidden (pause still works). The YouTube
 * player stops when a phone's screen locks; the anchor cannot change that.
 *
 * UMD: window.TrueShuffle.transport in the browser, module.exports in Node
 * (silentWav and the bookkeeping work without a document).
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.transport = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var ACTIONS = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'];
	var LOG_MAX = 20;
	var LOADING_GRACE_MS = 15000;   // a track change: keep the anchor going this long while YouTube loads
	var POSITION_GAP_MS = 1000;
	// Ten seconds: Chrome treats media shorter than five seconds as a one-shot sound.
	var ANCHOR_SECONDS = 10, ANCHOR_RATE = 8000;

	// A WAV file of silence: 8-bit mono PCM, `rate` samples a second. -> Uint8Array
	function silentWav(seconds, rate) {
		rate = rate || ANCHOR_RATE;
		var n = Math.max(1, Math.round((seconds || 1) * rate)), buf = new Uint8Array(44 + n), i;
		function str(at, s) { for (var k = 0; k < s.length; k++) buf[at + k] = s.charCodeAt(k); }
		function u32(at, v) { buf[at] = v & 255; buf[at + 1] = (v >>> 8) & 255; buf[at + 2] = (v >>> 16) & 255; buf[at + 3] = (v >>> 24) & 255; }
		function u16(at, v) { buf[at] = v & 255; buf[at + 1] = (v >>> 8) & 255; }
		str(0, 'RIFF'); u32(4, 36 + n); str(8, 'WAVE');
		str(12, 'fmt '); u32(16, 16); u16(20, 1); u16(22, 1); u32(24, rate); u32(28, rate); u16(32, 1); u16(34, 8);
		str(36, 'data'); u32(40, n);
		for (i = 0; i < n; i++) buf[44 + i] = 128;   // the middle of unsigned 8-bit samples: silence
		return buf;
	}

	// opts: { onPlay, onPause, onNext, onPrev, onSeek(sec), onSeekBy(deltaSec), onLog(log),
	//         mobile (a phone: the hidden-page guard), enabled (default true), now }
	function create(opts) {
		opts = opts || {};
		var doc = root.document || null, nav = root.navigator || null;
		var ms = nav && nav.mediaSession ? nav.mediaSession : null;
		var enabled = opts.enabled !== false, mobile = !!opts.mobile, hidden = false;
		var anchor = null, url = null, want = 'idle', graceTimer = 0, lastPos = 0, log = [], dead = false;
		function now() { return opts.now ? opts.now() : Date.now(); }
		function note(action, handled) {
			log.unshift({ at: now(), action: action, handled: !!handled, hidden: hidden });
			if (log.length > LOG_MAX) log.length = LOG_MAX;
			if (typeof opts.onLog === 'function') opts.onLog(log.slice());
		}
		function ensureAnchor() {
			if (anchor || !doc || !enabled || dead) return anchor;
			var URL_ = root.URL, Blob_ = root.Blob;
			if (!URL_ || !URL_.createObjectURL || !Blob_) return null;
			url = URL_.createObjectURL(new Blob_([silentWav(ANCHOR_SECONDS, ANCHOR_RATE)], { type: 'audio/wav' }));
			anchor = doc.createElement('audio');
			anchor.src = url;
			anchor.loop = true;
			anchor.preload = 'auto';
			anchor.volume = 1;
			return anchor;
		}
		function anchorPlay() {
			if (hidden || !enabled) return;
			var a = ensureAnchor();
			if (!a || !a.paused) return;
			var p = a.play();
			if (p && p.catch) p.catch(function () { note('anchor-refused', false); });
		}
		function anchorPause() { if (anchor && !anchor.paused) anchor.pause(); }
		function setState(state) {
			if (!ms) return;
			try { ms.playbackState = state === 'playing' || state === 'loading' ? 'playing' : state === 'paused' ? 'paused' : 'none'; } catch (e) { /* older browsers */ }
		}
		function mirror(state) {
			want = state;
			clearTimeout(graceTimer);
			setState(state);
			if (!enabled) { anchorPause(); return; }
			if (state === 'playing') anchorPlay();
			else if (state === 'loading') { if (anchor && !anchor.paused) graceTimer = setTimeout(function () { if (want === 'loading') anchorPause(); }, LOADING_GRACE_MS); }
			else anchorPause();
		}
		function call(fn, a) { if (typeof fn !== 'function') return false; fn(a); return true; }
		var handlers = {
			play: function () { return hidden ? false : call(opts.onPlay); },
			pause: function () { return call(opts.onPause); },
			stop: function () { return call(opts.onPause); },
			previoustrack: function () { return hidden ? false : call(opts.onPrev); },
			nexttrack: function () { return hidden ? false : call(opts.onNext); },
			seekto: function (d) { return hidden || !d || d.seekTime == null ? false : call(opts.onSeek, +d.seekTime); },
			seekbackward: function (d) { return hidden ? false : call(opts.onSeekBy, -((d && d.seekOffset) || 10)); },
			seekforward: function (d) { return hidden ? false : call(opts.onSeekBy, (d && d.seekOffset) || 10); }
		};
		// What the operating system asked for; also the tests' way in.
		function fire(action, details) {
			var fn = handlers[action], handled = fn ? fn(details || {}) !== false : false;
			note(action, handled);
			return handled;
		}
		if (ms) ACTIONS.forEach(function (a) { try { ms.setActionHandler(a, function (d) { fire(a, d); }); } catch (e) { /* not offered here */ } });
		function onVisibility() {
			if (!mobile || !doc) return;
			hidden = doc.visibilityState === 'hidden';
			if (hidden) anchorPause(); else if (want === 'playing') anchorPlay();
		}
		if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);

		return {
			mirror: mirror,
			wake: function () { if (enabled && !hidden) anchorPlay(); },
			metadata: function (md) {
				if (!ms) return;
				try { ms.metadata = md && root.MediaMetadata ? new root.MediaMetadata(md) : null; } catch (e) { /* bad artwork, say */ }
			},
			position: function (p) {
				if (!ms || !ms.setPositionState || !p || !(p.duration > 0) || !isFinite(p.duration)) return;
				var t = now();
				if (t - lastPos < POSITION_GAP_MS) return;
				lastPos = t;
				try { ms.setPositionState({ duration: p.duration, position: Math.max(0, Math.min(p.duration, +p.position || 0)), playbackRate: 1 }); } catch (e) { /* out of range */ }
			},
			enable: function (on) {
				enabled = !!on;
				if (!enabled) anchorPause(); else if (want === 'playing') anchorPlay();
			},
			enabled: function () { return enabled; },
			// 'none' (not made yet), 'playing' or 'paused'
			anchorState: function () { return anchor ? (anchor.paused ? 'paused' : 'playing') : 'none'; },
			hidden: function () { return hidden; },
			log: function () { return log.slice(); },
			fire: fire,
			destroy: function () {
				dead = true;
				clearTimeout(graceTimer);
				anchorPause();
				if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
				if (ms) ACTIONS.forEach(function (a) { try { ms.setActionHandler(a, null); } catch (e) { /* fine */ } });
				if (url && root.URL && root.URL.revokeObjectURL) root.URL.revokeObjectURL(url);
				anchor = null;
			}
		};
	}

	return { create: create, silentWav: silentWav, ACTIONS: ACTIONS, LOG_MAX: LOG_MAX, ANCHOR_SECONDS: ANCHOR_SECONDS };
});
