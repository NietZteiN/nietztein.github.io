/*
 * True Shuffle: car mode, and installing the page as an app.
 *
 *     TS.car.enter(ctx)   TS.car.exit()   TS.car.active()   TS.car.refresh()
 *     TS.car.view(view, ctx)              the #/car page (it turns car mode on)
 *     TS.car.settings(box, ctx)           Settings > Car: the switches, Install app, In the car
 *     TS.car.previewsOff()                true while car mode is on: no 30-second previews
 *     TS.car.install() -> Promise<'accepted' | 'dismissed' | 'installed' | 'unavailable'>
 *     TS.car.installState() -> 'installed' | 'ready' | 'menu'
 *     TS.car.HELP, TS.car.HELP_STEPS, TS.car.HELP_NOTES   "In the car", as text the page can show
 *
 * Car mode is a CSS re-layout around the same #video: the YouTube iframe is
 * never moved in the DOM (moving it reloads it). body.is-car hides the top
 * bar, the sections, the main view, the player bar and the tabs, forces the
 * dark theme, and lays out the player with big controls: a strip (Exit,
 * Screen on, Signal ok, Test buttons, More), the player (at most 400 px wide,
 * never under 200 by 200, never covered), the title, the artist and work,
 * what comes next, Prev 96 / Play 120 / Next 96, and Like, Radio and New
 * songs at 80. Portrait stacks them; landscape puts the player on the left
 * and the controls on the right (layoutFor).
 *
 * Start (a tap on the big play button) starts the media-key anchor
 * (transport.wake), plays the queue or a radio when it is empty (startPlan),
 * keeps a Screen Wake Lock (wakeKeeper: asked again when the page is shown
 * again and after the browser lets it go), goes full screen (Settings, on by
 * default) and turns the screen sideways if asked (off by default). The wake
 * lock is also taken when car mode opens: the screen must stay on, because
 * YouTube's player stops when the screen locks.
 *
 * ctx is app.js's pageCtx. Used when there: h, U, L, words, ctl(), player(),
 * current(), trackOf(id), history(), lib(), play.radio(t), like(id),
 * liked(id), engine(), say(text), and the car's own hooks transport()
 * (transport.js's instance), toggle(), next(), prev() and endless(); without
 * those it falls back to the controller.
 *
 * UMD: window.TrueShuffle.car in the browser, module.exports in Node (the
 * pure parts: indicators, parseVoice, layoutFor, wakeKeeper, logLine,
 * startPlan, nextRatio, ratioName).
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.car = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	function ch(c) { return String.fromCharCode(c); }
	var DOT = ch(0xB7), RSQ = ch(0x2019), ELL = ch(0x2026);

	var WEAK_MS = 8000;             // buffering longer than this: "Weak signal"
	var WAKE_RETRY_MS = 15000;      // a refused wake lock is asked for again after this
	var VOICE_RESTART_MS = 400, VOICE_RETRY_MS = 5000, HEARD_MS = 3000;
	var LAND_MIN_W = 600;           // narrower than this, even sideways, the controls stack
	var KEYS = { fullscreen: 'carFullscreen', landscape: 'carLandscape', voice: 'carVoice', ratio: 'newRatio' };
	var RATIOS = [{ value: 0, name: 'None' }, { value: 0.5, name: 'Some' }, { value: 0.8, name: 'Lots' }];

	var HELP_STEPS = [
		'Pair the phone with the car once: turn on the phone' + RSQ + 's Bluetooth and add the phone in the car' + RSQ + 's Bluetooth setup.',
		'In the car, choose BT Audio as the source (press AUDIO, then BT Audio).',
		'Open True Shuffle on the phone: the installed app, or this page in Chrome.',
		'Open Car mode: the player bar' + RSQ + 's More, or press and hold the app' + RSQ + 's icon and choose Car mode.',
		'Press Start. The music plays, the screen stays on, and the steering wheel' + RSQ + 's buttons skip songs.'
	];
	var HELP_NOTES = [
		'A page cannot choose where its sound goes: Android sends all media sound to the car while the phone is connected over Bluetooth.',
		'YouTube' + RSQ + 's player stops when the screen locks, so the screen has to stay on. Car mode keeps it on while it is showing (a charger helps).',
		'If the wheel' + RSQ + 's buttons do nothing, press Test buttons in car mode and press next on the wheel: every press is listed. Media keys must be on (Settings, Playback).'
	];
	var HELP = 'In the car\n' + HELP_STEPS.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n\n' + HELP_NOTES.join('\n');

	// ---- The pure parts ---------------------------------------------------------------------------

	function pad2(n) { return (n < 10 ? '0' : '') + n; }
	// 42 -> '0:42', 3725 -> '1:02:05'
	function clock(sec) {
		sec = Math.max(0, Math.floor(+sec || 0));
		var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
		return (h ? h + ':' + pad2(m) : String(m)) + ':' + pad2(s);
	}

	// What the strip says. s: { wake: wakeKeeper state, online, offlineSince, loadingSince, now,
	// voice: 'off' | 'starting' | 'listening' | 'blocked' | 'error' | 'unsupported', heard: { cmd, at } }
	// -> { screen: { text, tone }, signal: { text, tone }, voice: { text, tone } | null }; tone: 'ok' 'warn' 'bad'
	function indicators(s) {
		s = s || {};
		var now = +s.now || 0, out = {};
		out.screen = s.wake === 'held' ? { text: 'Screen on', tone: 'ok' } : { text: 'Screen may turn off', tone: 'warn' };
		if (s.online === false) out.signal = { text: 'No signal ' + DOT + ' waiting ' + clock(s.offlineSince != null ? (now - s.offlineSince) / 1000 : 0), tone: 'bad' };
		else if (s.loadingSince != null && now - s.loadingSince > WEAK_MS) out.signal = { text: 'Weak signal', tone: 'warn' };
		else out.signal = { text: 'Signal ok', tone: 'ok' };
		var v = s.voice || 'off';
		if (v === 'off') out.voice = null;
		else if (s.heard && now - s.heard.at < HEARD_MS) out.voice = { text: 'Heard: ' + s.heard.cmd, tone: 'ok' };
		else if (v === 'listening') out.voice = { text: 'Listening', tone: 'ok' };
		else if (v === 'starting') out.voice = { text: 'Voice starting' + ELL, tone: 'warn' };
		else if (v === 'blocked') out.voice = { text: 'Microphone blocked', tone: 'bad' };
		else if (v === 'unsupported') out.voice = { text: 'No voice commands here', tone: 'warn' };
		else out.voice = { text: 'Voice: trying again', tone: 'warn' };
		return out;
	}

	// A voice command from what the speech recognition heard: 'next' 'previous' 'pause' 'play'
	// 'like' 'radio', or null. Only a short phrase counts (at most two words once fillers like
	// "please", "the" or "song" are left out), so talk and sung lyrics do not trigger it; with
	// two command words the last one wins ("play next" is next).
	var VOICE_WORDS = {
		next: 'next', skip: 'next', forward: 'next',
		previous: 'previous', back: 'previous', last: 'previous', prev: 'previous',
		pause: 'pause', stop: 'pause', wait: 'pause',
		play: 'play', resume: 'play', continue: 'play', unpause: 'play',
		like: 'like', love: 'like', heart: 'like',
		radio: 'radio'
	};
	var FILLERS = { please: 1, ok: 1, okay: 1, hey: 1, uh: 1, um: 1, the: 1, a: 1, song: 1, track: 1, one: 1, this: 1, that: 1, it: 1, go: 1, now: 1, start: 1, to: 1, me: 1, music: 1 };
	function parseVoice(text) {
		var words = String(text == null ? '' : text).toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !FILLERS[w]; });
		if (!words.length || words.length > 2) return null;
		for (var i = words.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(VOICE_WORDS, words[i])) return VOICE_WORDS[words[i]];
		return null;
	}

	// Portrait or landscape for a window: { name: 'portrait' | 'landscape', compact }.
	// Landscape when wider than tall and at least 600 px wide (two columns need that);
	// compact when short: a sideways phone under 380 px tall, or a portrait one under 640.
	function layoutFor(w, h) {
		w = +w || 0; h = +h || 0;
		var land = w > h && w >= LAND_MIN_W;
		return { name: land ? 'landscape' : 'portrait', compact: land ? h < 380 : h < 640 };
	}

	// One line of the media-key log (transport.js log()): '12:01:33 nexttrack ok'.
	function logLine(e) {
		if (!e) return '';
		var d = new Date(e.at);
		var time = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
		return time + ' ' + e.action + ' ' + (e.handled ? 'ok' : e.hidden ? 'ignored: the page was hidden' : 'not handled');
	}

	// What Start does: 'keep' (it plays already), 'resume' (the queue), 'radio' (the queue is
	// empty or over: a radio from the song that was on, the last one played, or any song),
	// 'nothing' (no music yet). s: { playerState, items, done, hasSeed }
	function startPlan(s) {
		s = s || {};
		if (s.playerState === 'playing' || s.playerState === 'loading') return 'keep';
		if (s.items > 0 && !s.done) return 'resume';
		return s.hasSeed ? 'radio' : 'nothing';
	}

	// The New songs dial: None 0, Some 0.5, Lots 0.8 (the ToyKit key newRatio).
	function nearest(v) {
		v = +v;
		if (!isFinite(v)) v = 0.5;
		var best = 0;
		RATIOS.forEach(function (r, i) { if (Math.abs(r.value - v) < Math.abs(RATIOS[best].value - v)) best = i; });
		return best;
	}
	function ratioName(v) { return RATIOS[nearest(v)].name; }
	function nextRatio(v) { return RATIOS[(nearest(v) + 1) % RATIOS.length].value; }

	// The Screen Wake Lock, kept: asked for on start(), asked again when the page is shown
	// again (the browser lets it go when the page is hidden) and right after the browser
	// releases it while the page shows; a refusal is tried again after retryMs; three
	// releases within a second of being granted wait retryMs too.
	// opts: { nav, doc, onChange(state), retryMs, now, setTimer, clearTimer }
	// state(): 'off' 'asking' 'held' 'lost' (let go, waiting to ask again) 'denied' 'unsupported'
	function wakeKeeper(opts) {
		opts = opts || {};
		var nav = opts.nav || root.navigator || null, doc = opts.doc || root.document || null;
		var setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
		var clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
		var now = opts.now || function () { return Date.now(); };
		var retryMs = opts.retryMs > 0 ? opts.retryMs : WAKE_RETRY_MS;
		var wanted = false, sentinel = null, asking = false, state = 'off', timer = 0, quick = 0, grantedAt = 0, listening = false, asked = 0;
		function set(s) { if (s === state) return; state = s; if (typeof opts.onChange === 'function') opts.onChange(s); }
		function visible() { return !doc || doc.visibilityState !== 'hidden'; }
		function supported() { return !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function'); }
		function later(ms) { clearTimer(timer); timer = setTimer(function () { timer = 0; ask(); }, ms); }
		function detach(s) {
			if (!s) return;
			if (s.removeEventListener) s.removeEventListener('release', onRelease);
			else if (s.onrelease === onRelease) s.onrelease = null;
		}
		function onRelease() {
			detach(sentinel);
			sentinel = null;
			if (!wanted) return;
			set('lost');
			quick = now() - grantedAt < 1000 ? quick + 1 : 0;
			if (!visible()) return;              // the page is hidden: visibilitychange asks again
			if (quick >= 3) later(retryMs); else ask();
		}
		function ask() {
			if (!wanted || asking || sentinel) return;
			if (!supported()) { set('unsupported'); return; }
			if (!visible()) { set('lost'); return; }
			asking = true;
			asked++;
			set('asking');
			var p;
			try { p = nav.wakeLock.request('screen'); } catch (e) { p = Promise.reject(e); }
			Promise.resolve(p).then(function (s) {
				asking = false;
				if (!wanted || !s) { if (s && s.release) { try { var r = s.release(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* gone */ } } return; }
				sentinel = s;
				grantedAt = now();
				if (s.addEventListener) s.addEventListener('release', onRelease); else s.onrelease = onRelease;
				set('held');
				if (s.released === true) onRelease();
			}, function () {
				asking = false;
				if (!wanted) return;
				set('denied');
				later(retryMs);
			});
		}
		function onVisibility() {
			if (!wanted || !visible() || sentinel || asking) return;
			clearTimer(timer);
			timer = 0;
			ask();
		}
		return {
			start: function () {
				if (wanted) { if (!sentinel && !asking && !timer) ask(); return; }
				wanted = true;
				quick = 0;
				if (doc && doc.addEventListener && !listening) { doc.addEventListener('visibilitychange', onVisibility); listening = true; }
				ask();
			},
			stop: function () {
				wanted = false;
				clearTimer(timer);
				timer = 0;
				if (listening && doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
				listening = false;
				var s = sentinel;
				sentinel = null;
				detach(s);
				if (s && s.release) { try { var r = s.release(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* already let go */ } }
				set('off');
			},
			state: function () { return state; },
			held: function () { return state === 'held'; },
			asked: function () { return asked; }
		};
	}

	// ---- Installing the app: the browser's offer is kept for the Install button ---------------------

	var deferredInstall = null, installedNow = false, installFns = [];
	function installChanged() { installFns = installFns.filter(function (f) { return f(); }); }
	if (root.document && root.addEventListener) {
		root.addEventListener('beforeinstallprompt', function (e) {
			// keep it: the page offers Install itself (Settings > Car, and car mode's More)
			if (e && e.preventDefault) e.preventDefault();
			deferredInstall = e;
			installChanged();
		});
		root.addEventListener('appinstalled', function () { deferredInstall = null; installedNow = true; installChanged(); });
	}
	function standalone() {
		try {
			if (root.matchMedia && (root.matchMedia('(display-mode: standalone)').matches || root.matchMedia('(display-mode: fullscreen)').matches)) return true;
		} catch (e) { /* old browser */ }
		return !!(root.navigator && root.navigator.standalone);
	}
	function installState() {
		if (installedNow || standalone()) return 'installed';
		return deferredInstall ? 'ready' : 'menu';
	}
	function install() {
		var e = deferredInstall;
		if (!e || typeof e.prompt !== 'function') return Promise.resolve(installState() === 'installed' ? 'installed' : 'unavailable');
		deferredInstall = null;            // an offer can be shown once
		try { e.prompt(); } catch (err) { installChanged(); return Promise.resolve('unavailable'); }
		return Promise.resolve(e.userChoice).then(function (c) {
			var out = (c && c.outcome) || 'dismissed';
			if (out === 'accepted') installedNow = true;
			installChanged();
			return out;
		}, function () { installChanged(); return 'dismissed'; });
	}

	// ---- The page: car mode -----------------------------------------------------------------------

	var CSS = [
		'body.ts.is-car { grid-template-rows: minmax(0, 1fr); background: var(--ts-chrome); color-scheme: dark; }',
		'body.ts.is-car .ts-top, body.ts.is-car .ts-side, body.ts.is-car .ts-main, body.ts.is-car .ts-bar, body.ts.is-car .ts-tabbar,',
		'body.ts.is-car .ts-now-rest, body.ts.is-car .ts-resizer, body.ts.is-car .ts-vbar, body.ts.is-car .ts-jobs, body.ts.is-car .ts-pvbar,',
		'body.ts.is-car .kit-footer, body.ts.is-car .ts-player-msg .ts-diag { display: none !important; }',
		'body.ts.is-car .ts-app {',
		'	grid-row: 1; height: 100%; min-height: 0; overflow: hidden; display: grid;',
		'	grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr) auto auto;',
		'	grid-template-areas: "strip" "video" "info" "pad" "row2"; gap: 12px;',
		'	padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));',
		'	background: var(--ts-chrome);',
		'}',
		'body.ts.is-car .ts-now { display: contents; }',
		'body.ts.is-car .ts-video { grid-area: video; display: block; position: relative; justify-self: center; align-self: center; width: min(100%, 400px); padding: 0; margin: 0; background: transparent; }',
		'body.ts.is-car .ts-player { width: 100%; height: auto; aspect-ratio: 16 / 9; min-width: 210px; min-height: 210px; max-height: none; border-radius: 12px; }',
		'body.ts.is-car .ts-player-msg { margin: 6px 0 0; border-radius: 10px; max-height: 60px; overflow: hidden; }',
		'.ts-car { display: contents; }',
		/* the strip */
		'.car-strip { grid-area: strip; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "exit status test more"; align-items: center; gap: 6px 10px; min-width: 0; }',
		'body.ts.is-car:not(.is-car-land) .car-strip { grid-template-areas: "exit . test more" "status status status status"; }',
		'.car-strip .car-exit { grid-area: exit; } .car-strip .car-test { grid-area: test; } .car-strip .car-more { grid-area: more; }',
		'.car-status { grid-area: status; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 18px; min-width: 0; font-size: 15px; font-weight: 650; color: var(--text); }',
		'.car-ind { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }',
		'.car-ind::before { content: ""; width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--ts-ok); }',
		'.car-ind.is-warn::before { background: var(--ts-cost); }',
		'.car-ind.is-bad { color: var(--kit-warn); } .car-ind.is-bad::before { background: var(--kit-warn); }',
		/* what plays */
		'.car-info { grid-area: info; min-height: 0; min-width: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: 6px; text-align: center; }',
		'.car-info.is-scroll { overflow-y: auto; justify-content: flex-start; overscroll-behavior: contain; }',
		'.car-title { margin: 0; font-size: 32px; line-height: 1.15; font-weight: 750; letter-spacing: -0.01em; color: var(--heading); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; flex: none; }',
		'.car-sub { margin: 0; font-size: 22px; line-height: 1.25; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }',
		'.car-next { margin: 0; font-size: 18px; line-height: 1.35; color: var(--text-2); min-height: 0; }',
		'.car-next b { color: var(--text); font-weight: 650; }',
		'.car-log-h { margin: 0; font-size: 18px; font-weight: 650; color: var(--heading); }',
		'.car-log { list-style: none; margin: 4px 0 0; padding: 0; font: 16px/1.5 var(--font-mono); color: var(--text); }',
		'.car-log .is-ok { color: var(--ts-ok); } .car-log .is-no { color: var(--kit-warn); }',
		'.car-help ol { margin: 4px 0 8px; padding-left: 1.4em; text-align: left; font-size: 17px; line-height: 1.4; color: var(--text); }',
		'.car-help p { margin: 0 0 6px; text-align: left; font-size: 15px; line-height: 1.4; }',
		/* the buttons */
		'.car-pad { grid-area: pad; display: flex; align-items: center; justify-content: center; gap: 18px; min-width: 0; }',
		'.car-row2 { grid-area: row2; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%; max-width: 460px; justify-self: center; }',
		'body.ts.is-car .car-pad .ts-btn--secondary, body.ts.is-car .car-row2 .ts-btn--secondary { background: var(--surface-2); border-color: var(--border-strong); color: var(--heading); }',
		'.ts-btn.car-play { --btn-h: 120px; } .ts-btn.car-play .ts-i { width: 60px; height: 60px; }',
		'.ts-btn.car-small { --btn-h: 80px; width: 100%; min-width: 80px; flex-direction: column; gap: 3px; padding: 0 6px; border-radius: 22px; font-size: 16px; }',
		'.ts-btn.car-small .ts-i { width: 28px; height: 28px; }',
		'.ts-btn.car-small .car-val { font-size: 13px; font-weight: 600; opacity: 0.8; }',
		'body.ts.is-car .ts-btn.car-small.is-on { color: var(--ts-like); }',
		/* sideways: the player and Like, Radio, New songs on the left; what plays and the transport on the right */
		'body.ts.is-car.is-car-land .ts-app { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto auto; grid-template-areas: "strip strip" "video info" "video pad" "row2 pad"; column-gap: 16px; row-gap: 10px; }',
		'body.ts.is-car.is-car-land .ts-video { width: min(100%, 400px, calc((100dvh - 172px) * 16 / 9)); }',
		'body.ts.is-car.is-car-land .ts-player-msg { display: none; }',
		'body.ts.is-car.is-car-land .car-info { text-align: left; justify-content: flex-end; }',
		'body.ts.is-car.is-car-land .car-info.is-scroll { justify-content: flex-start; }',
		'body.ts.is-car.is-car-land .car-row2 { max-width: none; }',
		/* a tall window sideways (a tablet, a desktop): the block in the middle, columns of at most 520 */
		'@media (min-height: 520px) {',
		'	body.ts.is-car.is-car-land .ts-app { grid-template-columns: minmax(0, 520px) minmax(0, 520px); justify-content: center; grid-template-rows: auto minmax(0, 1fr) auto auto auto minmax(0, 1fr); grid-template-areas: "strip strip" ". ." "video info" "video pad" "row2 pad" ". ."; }',
		'	body.ts.is-car.is-car-land .car-info { justify-content: flex-end; }',
		'}',
		'body.ts.is-car.is-car-land.is-car-compact .ts-app { gap: 6px 14px; padding-top: max(8px, env(safe-area-inset-top)); padding-bottom: max(8px, env(safe-area-inset-bottom)); }',
		'body.ts.is-car.is-car-land.is-car-compact .ts-video { width: min(100%, 400px, calc((100dvh - 148px) * 16 / 9)); }',
		'body.ts.is-car.is-car-compact .car-strip .ts-btn { --btn-h: 40px; }',
		'body.ts.is-car.is-car-compact .car-title { -webkit-line-clamp: 1; }',
		/* toasts and dialogs keep off the player */
		'body.ts.is-car .ts-toast { top: var(--car-toast-top, 72px); bottom: auto; left: calc(var(--car-cover-left, 0px) + (100vw - var(--car-cover-left, 0px)) / 2); max-width: calc(100vw - var(--car-cover-left, 0px) - 24px); }',
		'body.ts.is-car .ts-modal-back, body.ts.is-car .kit-backdrop { top: var(--car-cover-top, 0px); left: var(--car-cover-left, 0px); right: 0; }',
		'@media (max-width: 350px) { .car-pad { gap: 6px; } .ts-btn.car-play { --btn-h: 108px; } .car-pad .ts-btn--car { --btn-h: 88px; } }'
	].join('\n');

	function injectCss() {
		var doc = root.document;
		if (!doc || doc.getElementById('ts-car-css')) return;
		var st = doc.createElement('style');
		st.id = 'ts-car-css';
		st.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(st);
	}

	function kitLoad(k, d) { try { return root.ToyKit && root.ToyKit.load ? root.ToyKit.load(k, d) : d; } catch (e) { return d; } }
	function kitStore(k, v) { try { if (root.ToyKit && root.ToyKit.store) root.ToyKit.store(k, v); } catch (e) { /* private mode */ } }
	function fullscreenOn() { return kitLoad(KEYS.fullscreen, true) !== false; }
	function landscapeOn() { return kitLoad(KEYS.landscape, false) === true; }
	function voiceOn() { return kitLoad(KEYS.voice, false) === true; }
	function voiceSupported() { return !!(root.SpeechRecognition || root.webkitSpeechRecognition); }
	function uiOf(ctx) { return (ctx && ctx.U) || (root.TrueShuffle && root.TrueShuffle.ui) || null; }
	function hOf(ctx) { var U = uiOf(ctx); return (ctx && ctx.h) || (U && U.h); }
	function carHash() { return /^#\/car(?:[\/?]|$)/.test(root.location ? root.location.hash : ''); }

	var S = null;   // the session while car mode is on

	function $(id) { return root.document.getElementById(id); }
	function ctlOf() { return S && S.ctx.ctl ? S.ctx.ctl() : null; }
	function playerOf() { return S && S.ctx.player ? S.ctx.player() : null; }
	function trOf() { return S && typeof S.ctx.transport === 'function' ? S.ctx.transport() : null; }
	function trackOf(id) { return id && S && S.ctx.trackOf ? S.ctx.trackOf(id) : null; }
	function titleOf(t) { var w = S.ctx.words; return w && w.title ? w.title(t) : (t.title || ''); }
	function artistOf(t) { var w = S.ctx.words; return w && w.artist ? w.artist(t) : (t.artist || ''); }
	function say(text) { if (S && S.ctx.say) S.ctx.say(text); }
	function playerState() { var p = playerOf(); return p && p.state ? p.state() : 'idle'; }
	function isPlaying() { var st = playerState(); return st === 'playing' || st === 'loading'; }
	function text(el, s) { if (el && el.textContent !== s) el.textContent = s; }

	// the song to start a radio from when the queue is empty or over
	function seedTrack() {
		var ctx = S.ctx, c = ctlOf(), cur = c && c.current ? c.current() : null, t = trackOf(cur);
		if (t) return t;
		var hist = ctx.history ? ctx.history() || [] : [];
		for (var i = 0; i < hist.length && i < 50; i++) { t = hist[i] && trackOf(hist[i].id); if (t) return t; }
		var lib = ctx.lib ? ctx.lib() : null, L = ctx.L;
		var all = lib && L && L.list ? L.list(lib) : [];
		var ok = all.filter(function (x) { return !x.blocked && x.kind !== 'clip' && (!L.playable || L.playable(x)); });
		return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
	}

	// ---- the controls ----
	function toggle() {
		var tr = trOf();
		if (tr && tr.wake) tr.wake();
		if (S.ctx.toggle) { S.ctx.toggle(); return; }
		var c = ctlOf();
		if (c) c.toggle();
	}
	function nextSong() { if (S.ctx.next) S.ctx.next(); else { var c = ctlOf(); if (c) c.next(); } later(); }
	function prevSong() { if (S.ctx.prev) S.ctx.prev(); else { var c = ctlOf(); if (c) c.previous(); } later(); }
	function likeSong() {
		var c = ctlOf(), id = c ? c.current() : null, t = trackOf(id);
		if (!t) { say('Nothing is playing.'); return; }
		if (S.ctx.like) S.ctx.like(id);
		later();
	}
	function radio() {
		var c = ctlOf(), t = trackOf(c ? c.current() : null) || seedTrack();
		if (!t || !S.ctx.play || !S.ctx.play.radio) { say('Nothing to start a radio from yet.'); return; }
		S.ctx.play.radio(t);
		say('A radio from ' + titleOf(t) + '.');
		later();
	}
	function cycleRatio() {
		var v = nextRatio(kitLoad(KEYS.ratio, 0.5));
		kitStore(KEYS.ratio, v);
		var eng = S.ctx.engine ? S.ctx.engine() : null, fd = eng && eng.feeder ? eng.feeder() : null;
		var c = ctlOf(), t = trackOf(c ? c.current() : null);
		if (fd && fd.kind === 'radio' && t && S.ctx.play && S.ctx.play.radio) {
			S.ctx.play.radio(t);
			say('New songs: ' + ratioName(v) + '. The radio goes on from this song.');
		} else say('New songs: ' + ratioName(v) + ', for the next radio.');
		render();
	}
	function onPlay() {
		if (!S) return;
		if (!S.started) { start(); return; }
		toggle();
		later();
	}
	function start() {
		if (!S) return null;
		S.started = true;
		var tr = trOf();
		if (tr && tr.wake) tr.wake();
		var c = ctlOf(), st = c && c.state ? c.state() : null, ps = playerState();
		var seed = null, needSeed = !(ps === 'playing' || ps === 'loading') && !(st && st.items && st.items.length && !st.done);
		if (needSeed) seed = seedTrack();
		var plan = startPlan({ playerState: ps, items: st && st.items ? st.items.length : 0, done: !!(st && st.done), hasSeed: !!seed });
		if (plan === 'resume') toggle();
		else if (plan === 'radio') { if (S.ctx.play && S.ctx.play.radio) S.ctx.play.radio(seed); }
		else if (plan === 'nothing') say('Nothing to play yet: import your playlists in Settings first.');
		S.wake.start();
		var land = landscapeOn();
		(fullscreenOn() ? goFullscreen() : Promise.resolve(false)).then(function () { if (land && S) lockLandscape(); });
		render();
		return plan;
	}
	function goFullscreen() {
		var doc = root.document, de = doc.documentElement;
		if (doc.fullscreenElement || !de.requestFullscreen) return Promise.resolve(!!doc.fullscreenElement);
		try {
			return Promise.resolve(de.requestFullscreen({ navigationUI: 'hide' })).then(function () { if (S) S.fsByUs = true; return true; }, function () { return false; });
		} catch (e) { return Promise.resolve(false); }
	}
	function leaveFullscreen() {
		var doc = root.document;
		if (!doc.fullscreenElement || !doc.exitFullscreen) return;
		try { var p = doc.exitFullscreen(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* not ours */ }
	}
	function lockLandscape() {
		var o = root.screen && root.screen.orientation;
		if (!o || typeof o.lock !== 'function') return;
		try { var p = o.lock('landscape'); if (p && p.catch) p.catch(function () {}); S.locked = true; } catch (e) { /* only in full screen or the installed app */ }
	}

	// ---- voice commands (opt-in): the Web Speech API, while car mode shows ----
	function doVoice(cmd) {
		S.heard = { cmd: cmd, at: Date.now() };
		if (cmd === 'next') nextSong();
		else if (cmd === 'previous') prevSong();
		else if (cmd === 'pause') { if (isPlaying()) toggle(); }
		else if (cmd === 'play') { if (!S.started) start(); else if (!isPlaying()) toggle(); }
		else if (cmd === 'like') likeSong();
		else if (cmd === 'radio') radio();
		render();
	}
	function startVoice() {
		if (!S || S.rec) return;
		clearTimeout(S.voiceTimer);
		if (!voiceOn()) { S.voice = 'off'; return; }
		if (!voiceSupported()) { S.voice = 'unsupported'; return; }
		if (root.document.visibilityState === 'hidden') return;
		var Rec = root.SpeechRecognition || root.webkitSpeechRecognition, rec;
		try { rec = new Rec(); } catch (e) { S.voice = 'error'; return; }
		rec.lang = 'en-US';
		rec.continuous = true;
		rec.interimResults = false;
		rec.maxAlternatives = 3;
		S.rec = rec;
		S.voice = 'starting';
		S.voiceBlocked = false;
		rec.onstart = function () { if (S && S.rec === rec) { S.voice = 'listening'; render(); } };
		rec.onresult = function (e) {
			if (!S || S.rec !== rec) return;
			for (var i = e.resultIndex; i < e.results.length; i++) {
				var r = e.results[i];
				if (!r.isFinal) continue;
				for (var j = 0; j < r.length; j++) { var cmd = parseVoice(r[j].transcript); if (cmd) { doVoice(cmd); break; } }
			}
		};
		rec.onerror = function (e) {
			if (!S || S.rec !== rec) return;
			var err = e && e.error;
			if (err === 'not-allowed' || err === 'service-not-allowed') { S.voiceBlocked = true; S.voice = 'blocked'; }
			else if (err !== 'no-speech' && err !== 'aborted') S.voice = 'error';
			render();
		};
		rec.onend = function () {
			if (!S || S.rec !== rec) return;
			S.rec = null;
			if (S.voiceBlocked || !voiceOn() || root.document.visibilityState === 'hidden') { if (!S.voiceBlocked) S.voice = 'off'; render(); return; }
			S.voiceTimer = setTimeout(startVoice, S.voice === 'error' ? VOICE_RETRY_MS : VOICE_RESTART_MS);
		};
		try { rec.start(); } catch (e) { S.rec = null; S.voice = 'error'; }
	}
	function stopVoice(state) {
		if (!S) return;
		clearTimeout(S.voiceTimer);
		var r = S.rec;
		S.rec = null;
		if (r) { r.onend = r.onresult = r.onerror = r.onstart = null; try { r.abort(); } catch (e) { /* stopped */ } }
		S.voice = state || 'off';
	}
	function setVoice(on) {
		kitStore(KEYS.voice, on ? true : null);
		if (!S) return;
		if (on) startVoice(); else stopVoice('off');
		render();
	}

	// ---- drawing ----
	function build() {
		var h = S.h, U = S.U, E = S.els;
		var box = h('div', { class: 'ts-car', id: 'ts-car' });
		var strip = h('div', { class: 'car-strip', role: 'group', aria: { label: 'Car mode' } });
		E.exit = U.btn({ icon: 'close', label: 'Exit', variant: 'secondary', size: 'lg', cls: 'car-exit', title: 'Leave car mode', on: { click: function () { exit(); } } });
		E.status = h('div', { class: 'car-status', role: 'status', aria: { live: 'polite' } });
		E.screen = h('span', { class: 'car-ind' });
		E.signal = h('span', { class: 'car-ind' });
		E.voice = h('span', { class: 'car-ind', hidden: true });
		E.status.appendChild(E.screen);
		E.status.appendChild(E.signal);
		E.status.appendChild(E.voice);
		E.test = U.btn({ icon: 'keyboard', label: 'Test buttons', variant: 'secondary', size: 'lg', cls: 'car-test', pressed: false, title: 'List what the steering wheel' + RSQ + 's buttons send', on: { click: function () { S.testing = !S.testing; S.help = false; render(); } } });
		E.more = U.btn({ icon: 'more', label: 'More for car mode', iconOnly: true, variant: 'secondary', size: 'lg', menu: true, cls: 'car-more', on: { click: function (e) { moreMenu(e.currentTarget); } } });
		[E.exit, E.status, E.test, E.more].forEach(function (n) { strip.appendChild(n); });

		E.info = h('section', { class: 'car-info', aria: { label: 'Now playing' } });
		E.title = h('h2', { class: 'car-title' });
		E.sub = h('p', { class: 'car-sub' });
		E.next = h('div', { class: 'car-next', aria: { live: 'polite' } });
		E.info.appendChild(E.title);
		E.info.appendChild(E.sub);
		E.info.appendChild(E.next);

		var pad = h('div', { class: 'car-pad', role: 'group', aria: { label: 'Playback' } });
		E.prev = U.btn({ icon: 'prev', label: 'Previous song', iconOnly: true, variant: 'secondary', size: 'car', cls: 'car-prev', on: { click: prevSong } });
		E.play = U.btn({ icon: 'play', label: 'Start', iconOnly: true, variant: 'primary', size: 'car', cls: 'car-play', on: { click: onPlay } });
		E.nextBtn = U.btn({ icon: 'next', label: 'Next song', iconOnly: true, variant: 'secondary', size: 'car', cls: 'car-next-btn', on: { click: nextSong } });
		pad.appendChild(E.prev);
		pad.appendChild(E.play);
		pad.appendChild(E.nextBtn);

		var row2 = h('div', { class: 'car-row2', role: 'group', aria: { label: 'This song' } });
		E.like = U.btn({ icon: 'heart', label: 'Like', variant: 'secondary', size: 'car', cls: 'car-small car-like', pressed: false, on: { click: likeSong } });
		E.radio = U.btn({ icon: 'radio', label: 'Radio', variant: 'secondary', size: 'car', cls: 'car-small car-radio', title: 'A radio from this song', on: { click: radio } });
		E.ratio = U.btn({ icon: 'sparkle', label: 'New songs', variant: 'secondary', size: 'car', cls: 'car-small car-ratio', title: 'How many songs a radio brings that you do not have: None, Some or Lots', on: { click: cycleRatio } });
		E.ratioVal = h('span', { class: 'car-val' });
		E.ratio.appendChild(E.ratioVal);
		row2.appendChild(E.like);
		row2.appendChild(E.radio);
		row2.appendChild(E.ratio);

		box.appendChild(strip);
		box.appendChild(E.info);
		box.appendChild(pad);
		box.appendChild(row2);
		($('app') || root.document.body).appendChild(box);
		E.box = box;
	}
	function setInd(el, ind) {
		if (!ind) { el.hidden = true; return; }
		el.hidden = false;
		text(el, ind.text);
		var cls = 'car-ind' + (ind.tone === 'warn' ? ' is-warn' : ind.tone === 'bad' ? ' is-bad' : '');
		if (el.className !== cls) el.className = cls;
	}
	function drawLower() {
		var E = S.els, h = S.h, key, tr = trOf();
		if (S.testing) {
			var lg = tr && tr.log ? tr.log().slice(0, 6) : [];
			key = 'test|' + (tr ? (tr.enabled && !tr.enabled() ? 'off' : 'on') : 'none') + '|' + lg.map(function (e) { return e.at + e.action + e.handled; }).join(',');
			if (key === S.lowerKey) return;
			S.lowerKey = key;
			S.U.clear(E.next);
			E.next.appendChild(h('p', { class: 'car-log-h', text: 'Press the wheel' + RSQ + 's next button' }));
			var ol = h('ol', { class: 'car-log' });
			if (!tr) ol.appendChild(h('li', { class: 'is-no', text: 'The buttons are not connected to car mode in this page.' }));
			else if (tr.enabled && !tr.enabled()) ol.appendChild(h('li', { class: 'is-no', text: 'Media keys are off: Settings, Playback.' }));
			else if (!lg.length) ol.appendChild(h('li', { text: 'Nothing yet. Play a song first: the buttons reach the page only while it plays.' }));
			lg.forEach(function (e) { ol.appendChild(h('li', { class: e.handled ? 'is-ok' : 'is-no', text: logLine(e) })); });
			E.next.appendChild(ol);
			return;
		}
		if (S.help) {
			if (S.lowerKey === 'help') return;
			S.lowerKey = 'help';
			S.U.clear(E.next);
			var hb = h('div', { class: 'car-help' });
			var ol2 = h('ol');
			HELP_STEPS.forEach(function (s) { ol2.appendChild(h('li', { text: s })); });
			hb.appendChild(ol2);
			HELP_NOTES.forEach(function (s) { hb.appendChild(h('p', { text: s })); });
			E.next.appendChild(hb);
			return;
		}
		var line = nextLine();
		key = 'next|' + line.join('|');
		if (key === S.lowerKey) return;
		S.lowerKey = key;
		S.U.clear(E.next);
		if (line.length === 2) { E.next.appendChild(S.h('span', { text: line[0] })); E.next.appendChild(S.h('b', { text: line[1] })); }
		else E.next.appendChild(S.h('span', { text: line[0] }));
	}
	function nextLine() {
		if (!S.started && !isPlaying()) return ['Press play to start. The screen will stay on.'];
		var c = ctlOf(), st = c && c.state ? c.state() : null;
		var id = st && st.items ? st.items[st.index + 1] : null, t = trackOf(id);
		if (t) { var a = artistOf(t); return ['Next: ', titleOf(t) + (a ? ' ' + DOT + ' ' + a : '')]; }
		if (S.ctx.endless && !S.ctx.endless()) return ['Nothing after this song.'];
		return ['Next: a radio from this song carries on.'];
	}
	function layout() {
		var doc = root.document, body = doc.body, L = layoutFor(root.innerWidth, root.innerHeight);
		// turned sideways or back: an open menu was placed for the other layout
		if (S.layout && S.layout !== L.name && S.U.closeMenu) S.U.closeMenu();
		S.layout = L.name;
		body.classList.toggle('is-car-land', L.name === 'landscape');
		body.classList.toggle('is-car-compact', !!L.compact);
		var v = $('video'), strip = S.els.box ? S.els.box.querySelector('.car-strip') : null;
		if (!v) return;
		var r = v.getBoundingClientRect(), sr = strip ? strip.getBoundingClientRect() : { bottom: 0 };
		var land = L.name === 'landscape';
		var vars = {
			'--car-cover-top': (land ? 0 : Math.round(r.bottom + 8)) + 'px',
			'--car-cover-left': (land ? Math.round(r.right + 8) : 0) + 'px',
			'--car-toast-top': Math.round((land ? sr.bottom : r.bottom) + 8) + 'px'
		};
		Object.keys(vars).forEach(function (k) { if (body.style.getPropertyValue(k) !== vars[k]) body.style.setProperty(k, vars[k]); });
	}
	function render() {
		if (!S) return;
		layout();
		var E = S.els, now = Date.now();
		var ind = indicators({ wake: S.wake.state(), online: S.online, offlineSince: S.offlineSince, loadingSince: S.loadingSince, now: now, voice: S.voice, heard: S.heard });
		setInd(E.screen, ind.screen);
		E.screen.title = S.wake.state() === 'unsupported' ? 'This browser cannot keep the screen on: set a long screen timeout in Android' + RSQ + 's settings.' : '';
		setInd(E.signal, ind.signal);
		setInd(E.voice, ind.voice);

		var c = ctlOf(), id = c ? c.current() : null, t = trackOf(id), ctx = S.ctx;
		var lib = ctx.lib ? ctx.lib() : null, has = !!(lib && ctx.L && ctx.L.list && ctx.L.list(lib).length);
		if (t) {
			text(E.title, titleOf(t));
			var a = artistOf(t);
			text(E.sub, a + (t.work ? (a ? ' ' + DOT + ' ' : '') + t.work : ''));
		} else {
			text(E.title, has ? 'Nothing playing' : 'No music yet');
			text(E.sub, has ? 'Press play for your music, or a radio' : 'Import your playlists in Settings first');
		}
		E.info.classList.toggle('is-scroll', !!(S.testing || S.help));
		E.sub.hidden = !!(S.testing || S.help) && L_compact();
		drawLower();

		var playing = isPlaying(), want = !S.started ? ['play', 'Start'] : playing ? ['pause', 'Pause'] : ['play', 'Play'];
		if (E.play.dataset.label !== want[1]) S.U.btnState(E.play, { icon: want[0], label: want[1] });
		var liked = !!(t && ctx.liked && ctx.liked(id));
		if ((E.like.getAttribute('aria-pressed') === 'true') !== liked) S.U.btnState(E.like, { pressed: liked, label: liked ? 'Liked' : 'Like' });
		E.like.disabled = !t;
		E.radio.disabled = !t && !has;
		text(E.ratioVal, ratioName(kitLoad(KEYS.ratio, 0.5)));
		if ((E.test.getAttribute('aria-pressed') === 'true') !== !!S.testing) S.U.btnState(E.test, { pressed: !!S.testing });
	}
	function L_compact() { return root.document.body.classList.contains('is-car-compact'); }
	function later() { if (S) setTimeout(render, 60); }

	function moreMenu(anchor) {
		var U = S.U, fs = fullscreenOn(), land = landscapeOn(), vo = voiceOn(), vs = voiceSupported(), doc = root.document;
		U.openMenu(anchor, [
			{ heading: 'Car mode' },
			{ label: 'Full screen when I press Start', icon: 'fullscreen', checked: fs, onSelect: function () { kitStore(KEYS.fullscreen, fs ? false : null); } },
			{ label: 'Turn sideways when I press Start', icon: 'rotate', desc: 'Only in full screen or the installed app', checked: land, onSelect: function () { kitStore(KEYS.landscape, land ? null : true); if (!land && S && doc.fullscreenElement) lockLandscape(); } },
			{ label: 'Voice commands', icon: 'volume', desc: vs ? 'Say next, previous, pause, play, like or radio. What the microphone hears goes to Google.' : 'This browser cannot listen for them', checked: vo, disabled: !vs && !vo, onSelect: function () { setVoice(!vo); } },
			{ sep: true },
			{ label: doc.fullscreenElement ? 'Leave full screen' : 'Full screen now', icon: 'fullscreen', onSelect: function () { if (doc.fullscreenElement) leaveFullscreen(); else goFullscreen(); } },
			{ label: S.help ? 'Hide how to connect' : 'How to connect in the car', icon: 'info', onSelect: function () { S.help = !S.help; S.testing = false; render(); } },
			installState() === 'ready' ? { label: 'Install as an app', icon: 'download', onSelect: function () { install().then(function (o) { say(o === 'accepted' ? 'Installed: True Shuffle is on the home screen.' : 'Not installed.'); }); } } : null,
			{ sep: true },
			{ label: 'Leave car mode', icon: 'close', onSelect: function () { exit(); } }
		], { label: 'Car mode', alignRight: true });
	}

	// ---- on and off ----
	function enter(ctx, opts) {
		if (!root.document || !root.document.body) return false;
		opts = opts || {};
		if (S) {
			if (ctx) S.ctx = ctx;
			if (opts.byRoute) S.byRoute = true;
			render();
			return true;
		}
		ctx = ctx || {};
		var U = uiOf(ctx), h = hOf(ctx);
		if (!U || !h) return false;
		injectCss();
		var doc = root.document, body = doc.body, html = doc.documentElement, nav = root.navigator || {};
		S = {
			ctx: ctx, U: U, h: h, els: {}, offs: [], started: false, testing: false, help: false,
			byRoute: !!opts.byRoute, theme: html.getAttribute('data-theme'), fsByUs: false, locked: false,
			online: nav.onLine !== false, offlineSince: nav.onLine === false ? Date.now() : null,
			loadingSince: null, voice: 'off', heard: null, rec: null, voiceTimer: 0, lowerKey: ''
		};
		S.wake = wakeKeeper({ onChange: function () { render(); } });
		html.setAttribute('data-theme', 'dark');
		if (root.ToyKit && root.ToyKit.onTheme) S.offs.push(root.ToyKit.onTheme(function (t) { if (!S) return; S.theme = t; html.setAttribute('data-theme', 'dark'); }));
		build();
		body.classList.add('is-car');

		function on(target, name, fn, capture) { target.addEventListener(name, fn, !!capture); S.offs.push(function () { target.removeEventListener(name, fn, !!capture); }); }
		on(root, 'resize', function () { render(); });
		on(root, 'orientationchange', function () { render(); });
		on(root, 'online', function () { S.online = true; S.offlineSince = null; render(); });
		on(root, 'offline', function () { S.online = false; if (S.offlineSince == null) S.offlineSince = Date.now(); render(); });
		on(root, 'hashchange', function () { if (S && S.byRoute && !carHash()) exit({ nav: false }); });
		on(doc, 'visibilitychange', function () {
			if (!S) return;
			if (doc.visibilityState === 'hidden') stopVoice(S.voice === 'blocked' ? 'blocked' : 'off');
			else if (voiceOn() && !S.voiceBlocked) startVoice();
			render();
		});
		var video = $('video');
		// the poster's "Press play" starts car mode properly (wake lock, full screen) instead
		if (video) on(video, 'click', function (e) { var t = e.target; if (S && !S.started && t && t.closest && t.closest('#poster')) { e.stopPropagation(); e.preventDefault(); onPlay(); } }, true);
		var p = playerOf();
		if (p && p.on) {
			if (p.state && p.state() === 'loading') S.loadingSince = Date.now();
			S.offs.push(p.on('state', function (e) {
				if (!S) return;
				if (e && e.state === 'loading') { if (S.loadingSince == null) S.loadingSince = Date.now(); } else S.loadingSince = null;
				render();
			}));
		}
		S.tick = setInterval(render, 1000);
		// One sound at a time, and no previews in the car: the page's previews stop on this.
		if (U.bus && U.bus.emit) U.bus.emit('audio', { by: 'car' });
		S.wake.start();
		if (voiceOn()) startVoice();
		render();
		if (U.safe && U.safe.update) U.safe.update();
		try { S.els.play.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
		return true;
	}
	function exit(opts) {
		if (!S) return false;
		opts = opts || {};
		var s = S, doc = root.document, body = doc.body, html = doc.documentElement;
		stopVoice('off');
		s.wake.stop();
		clearInterval(s.tick);
		s.offs.forEach(function (off) { try { off(); } catch (e) { /* gone */ } });
		if (s.U.closeMenu) s.U.closeMenu();
		if (s.locked && root.screen && root.screen.orientation && root.screen.orientation.unlock) { try { root.screen.orientation.unlock(); } catch (e) { /* not locked */ } }
		if (s.fsByUs && doc.fullscreenElement === html) leaveFullscreen();
		S = null;
		if (s.els.box && s.els.box.parentNode) s.els.box.parentNode.removeChild(s.els.box);
		body.classList.remove('is-car', 'is-car-land', 'is-car-compact');
		['--car-cover-top', '--car-cover-left', '--car-toast-top'].forEach(function (k) { body.style.removeProperty(k); });
		if (s.theme) html.setAttribute('data-theme', s.theme); else html.removeAttribute('data-theme');
		if (s.U.safe && s.U.safe.update) s.U.safe.update();
		if (opts.nav !== false && carHash() && root.location) {
			try { root.location.replace(root.location.pathname + root.location.search + '#/'); } catch (e) { root.location.hash = '#/'; }
		}
		return true;
	}
	function active() { return !!S; }
	function refresh() { if (S) render(); }
	function previewsOff() { return !!S; }

	// The #/car page: it turns car mode on; it shows when car mode is left without leaving it.
	function view(viewEl, ctx) {
		var h = hOf(ctx), U = uiOf(ctx);
		if (!h || !U) return;
		viewEl.appendChild(h('h1', { class: 'ts-h1', text: 'Car mode' }));
		viewEl.appendChild(h('p', { class: 'ts-muted', text: 'Big buttons, the screen kept on, and the steering wheel' + RSQ + 's buttons. Pair the phone with the car, choose BT Audio there, then press Start.' }));
		viewEl.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ icon: 'car', label: 'Open car mode', variant: 'primary', size: 'lg', on: { click: function () { enter(ctx, { byRoute: carHash() }); } } })]));
		helpBlock(viewEl, h);
		if (S) S.byRoute = true;
		else if (carHash()) enter(ctx, { byRoute: true });
	}
	function helpBlock(box, h) {
		box.appendChild(h('h3', { text: 'In the car' }));
		var ol = h('ol', { class: 'car-help-steps' });
		HELP_STEPS.forEach(function (s) { ol.appendChild(h('li', { text: s })); });
		box.appendChild(ol);
		HELP_NOTES.forEach(function (s) { box.appendChild(h('p', { class: 'ts-muted', text: s })); });
	}

	// Settings > Car: the switches, Install app, and In the car.
	function settings(box, ctx) {
		var h = hOf(ctx), U = uiOf(ctx);
		if (!h || !U) return;
		box.appendChild(h('p', { text: 'Car mode: big buttons, the screen kept on, and the steering wheel' + RSQ + 's buttons. It plays only through YouTube' + RSQ + 's player, which stays on screen; there are no 30-second previews in it.' }));
		box.appendChild(h('div', { class: 'ts-row-btns' }, [U.btn({ icon: 'car', label: 'Open car mode', variant: 'secondary', href: '#/car' })]));
		function check(key, on, title, desc, write, disabled) {
			var lab = U.check ? U.check({ title: title, desc: desc, checked: on, disabled: disabled, onChange: write }) : h('label', { class: 'ts-check' }, [h('input', { type: 'checkbox', checked: on, disabled: disabled, on: { change: function (e) { write(e.target.checked); } } }), h('span', { text: title + '. ' + desc })]);
			box.appendChild(lab);
			return lab.input || lab.querySelector('input');
		}
		check(KEYS.fullscreen, fullscreenOn(), 'Full screen', 'Car mode fills the screen when you press Start.', function (v) { kitStore(KEYS.fullscreen, v ? null : false); });
		check(KEYS.landscape, landscapeOn(), 'Turn the screen sideways', 'When you press Start. Phones allow it only in full screen or in the installed app.', function (v) { kitStore(KEYS.landscape, v ? true : null); });
		var vs = voiceSupported();
		check(KEYS.voice, voiceOn(), 'Voice commands', 'Say next, previous, pause, play, like or radio in car mode. They use the browser' + RSQ + 's speech recognition, which sends what the microphone hears to Google while car mode is on and showing.' + (vs ? '' : ' This browser has none.'), function (v) { setVoice(v); }, !vs && !voiceOn());

		box.appendChild(h('h3', { text: 'Install as an app' }));
		var row = h('div', { class: 'ts-row-btns' });
		box.appendChild(row);
		function drawInstall() {
			if (!row.isConnected && row.parentNode !== box) return false;
			U.clear(row);
			var st = installState();
			if (st === 'installed') row.appendChild(h('span', { class: 'ts-muted', text: 'Installed. Press and hold its icon for Car mode and For you.' }));
			else if (st === 'ready') row.appendChild(U.btn({ icon: 'download', label: 'Install app', variant: 'secondary', on: { click: function () { install().then(function (o) { if (ctx.say) ctx.say(o === 'accepted' ? 'Installed: True Shuffle is on the home screen.' : 'Not installed.'); drawInstall(); }); } } }));
			else row.appendChild(h('span', { class: 'ts-muted', text: 'To install it, open the browser' + RSQ + 's menu (the three dots in Chrome) and choose Install app or Add to Home screen. Installed, it opens without the browser' + RSQ + 's bars, and pressing and holding its icon offers Car mode and For you.' }));
			return true;
		}
		drawInstall();
		installFns.push(function () { return row.isConnected ? (drawInstall(), true) : false; });
		helpBlock(box, h);
	}

	return {
		enter: enter, exit: exit, active: active, refresh: refresh, previewsOff: previewsOff,
		view: view, settings: settings, install: install, installState: installState,
		HELP: HELP, HELP_STEPS: HELP_STEPS, HELP_NOTES: HELP_NOTES,
		indicators: indicators, parseVoice: parseVoice, layoutFor: layoutFor, wakeKeeper: wakeKeeper,
		logLine: logLine, startPlan: startPlan, nextRatio: nextRatio, ratioName: ratioName, RATIOS: RATIOS,
		KEYS: KEYS, WEAK_MS: WEAK_MS
	};
});
