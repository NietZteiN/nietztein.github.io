// car: car mode's pure parts (car.js): the strip's words, the voice commands, the
// layout for portrait and landscape, the wake lock kept with a fake navigator,
// the media-key log lines, what Start does, the New songs dial, the help text.
module.exports = function (h) {
	var path = require('path');
	var C = require(path.join(h.HERE, 'car.js'));
	var DOT = String.fromCharCode(0xB7);

	// a fake navigator.wakeLock and document: request() answers when told to
	function fakes() {
		var doc = { visibilityState: 'visible', subs: [] };
		doc.addEventListener = function (n, fn) { if (n === 'visibilitychange') doc.subs.push(fn); };
		doc.removeEventListener = function (n, fn) { doc.subs = doc.subs.filter(function (f) { return f !== fn; }); };
		doc.show = function (state) { doc.visibilityState = state; doc.subs.slice().forEach(function (f) { f(); }); };
		var lock = { asks: 0, refuse: false, live: [] };
		lock.request = function (type) {
			lock.asks++;
			lock.type = type;
			if (lock.refuse) return Promise.reject(new Error('NotAllowedError'));
			var s = { released: false, subs: [] };
			s.addEventListener = function (n, fn) { if (n === 'release') s.subs.push(fn); };
			s.removeEventListener = function (n, fn) { s.subs = s.subs.filter(function (f) { return f !== fn; }); };
			s.release = function () { if (s.released) return Promise.resolve(); s.released = true; lock.live = lock.live.filter(function (x) { return x !== s; }); s.subs.slice().forEach(function (f) { f(); }); return Promise.resolve(); };
			lock.live.push(s);
			return Promise.resolve(s);
		};
		var timers = [];
		return {
			doc: doc, lock: lock, nav: { wakeLock: lock }, timers: timers,
			setTimer: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
			clearTimer: function (id) { if (id && timers[id - 1]) timers[id - 1].fn = null; },
			runTimers: function () { var t = timers.splice(0); t.forEach(function (x) { if (x.fn) x.fn(); }); }
		};
	}
	function settle() { return new Promise(function (r) { setImmediate(r); }); }

	h.describe('car', async function () {
		// ---- indicators: the strip's words ----
		var t0 = 1000000;
		var a = C.indicators({ wake: 'held', online: true, now: t0 });
		h.eq([a.screen.text, a.signal.text, a.voice], ['Screen on', 'Signal ok', null], 'indicators: a held wake lock and a signal: "Screen on", "Signal ok", no voice line');
		h.eq(C.indicators({ wake: 'lost', online: true, now: t0 }).screen, { text: 'Screen may turn off', tone: 'warn' }, 'indicators: a lost wake lock: "Screen may turn off"');
		h.eq(['off', 'asking', 'denied', 'unsupported'].map(function (w) { return C.indicators({ wake: w }).screen.text; }), ['Screen may turn off', 'Screen may turn off', 'Screen may turn off', 'Screen may turn off'], 'indicators: anything but a held lock may let the screen turn off');
		h.eq(C.indicators({ wake: 'held', online: false, offlineSince: t0 - 42000, now: t0 }).signal, { text: 'No signal ' + DOT + ' waiting 0:42', tone: 'bad' }, 'indicators: offline for 42 s: "No signal . waiting 0:42"');
		h.eq(C.indicators({ online: false, offlineSince: t0 - 3725000, now: t0 }).signal.text, 'No signal ' + DOT + ' waiting 1:02:05', 'indicators: the wait counts hours too');
		h.eq(C.indicators({ online: false, now: t0 }).signal.text, 'No signal ' + DOT + ' waiting 0:00', 'indicators: offline since an unknown time starts at 0:00');
		h.eq(C.indicators({ online: true, loadingSince: t0 - 9000, now: t0 }).signal, { text: 'Weak signal', tone: 'warn' }, 'indicators: buffering for 9 s: "Weak signal"');
		h.eq(C.indicators({ online: true, loadingSince: t0 - 8000, now: t0 }).signal.text, 'Signal ok', 'indicators: buffering for 8 s exactly is still fine (more than 8 s is weak)');
		h.eq(C.indicators({ online: false, offlineSince: t0, loadingSince: t0 - 20000, now: t0 + 5000 }).signal.text, 'No signal ' + DOT + ' waiting 0:05', 'indicators: no signal wins over weak signal');
		h.eq(C.WEAK_MS, 8000, 'WEAK_MS: eight seconds');
		h.eq(['listening', 'starting', 'blocked', 'unsupported', 'error'].map(function (v) { return C.indicators({ voice: v, now: t0 }).voice.text; }), ['Listening', 'Voice starting' + String.fromCharCode(0x2026), 'Microphone blocked', 'No voice commands here', 'Voice: trying again'], 'indicators: the voice line in each state');
		h.eq(C.indicators({ voice: 'listening', heard: { cmd: 'next', at: t0 - 1000 }, now: t0 }).voice.text, 'Heard: next', 'indicators: a command heard shows for a moment');
		h.eq(C.indicators({ voice: 'listening', heard: { cmd: 'next', at: t0 - 5000 }, now: t0 }).voice.text, 'Listening', 'indicators: then the line goes back to Listening');
		h.eq(C.indicators({ voice: 'off', heard: { cmd: 'next', at: t0 }, now: t0 }).voice, null, 'indicators: voice off, no voice line');

		// ---- parseVoice: the voice commands ----
		var heard = ['next', 'Next.', 'next song please', 'skip', 'Skip this one', 'previous', 'go back', 'last song', 'pause', 'Stop.', 'play', 'resume', 'continue', 'like', 'like this song', 'radio', 'start radio', 'play the radio', 'play next', 'OK next'];
		h.eq(heard.map(C.parseVoice), ['next', 'next', 'next', 'next', 'next', 'previous', 'previous', 'previous', 'pause', 'pause', 'play', 'play', 'play', 'like', 'like', 'radio', 'radio', 'radio', 'next', 'next'], 'parseVoice: next, previous, pause, play, like and radio, with fillers and punctuation, the last command word winning');
		h.eq(['', null, undefined, 'hello there', 'what', 'I want to hear the next one now', 'skip to the next track after this one ok', 'we should stop for coffee', 'play that funky music white boy'].map(C.parseVoice), [null, null, null, null, null, null, null, null, null], 'parseVoice: talk, long phrases and lyrics are not commands');

		// ---- layoutFor: portrait or landscape ----
		h.eq(C.layoutFor(390, 844), { name: 'portrait', compact: false }, 'layoutFor: a phone upright is portrait');
		h.eq(C.layoutFor(844, 390), { name: 'landscape', compact: false }, 'layoutFor: the phone sideways is landscape');
		h.eq(C.layoutFor(800, 360), { name: 'landscape', compact: true }, 'layoutFor: a short phone sideways is compact landscape');
		h.eq(C.layoutFor(360, 600), { name: 'portrait', compact: true }, 'layoutFor: a short window upright is compact portrait');
		h.eq(C.layoutFor(1280, 800), { name: 'landscape', compact: false }, 'layoutFor: a desktop window is landscape');
		h.eq(C.layoutFor(560, 400).name, 'portrait', 'layoutFor: under 600 px wide the controls stack even sideways');
		h.eq(C.layoutFor(700, 700).name, 'portrait', 'layoutFor: a square window is portrait');

		// ---- wakeKeeper: the Screen Wake Lock, asked again ----
		var f = fakes(), states = [], clockF = 0;
		// a clock that moves on 5 s before each release, so none counts as a quick one
		var wk = C.wakeKeeper({ nav: f.nav, doc: f.doc, setTimer: f.setTimer, clearTimer: f.clearTimer, retryMs: 15000, now: function () { return clockF; }, onChange: function (s) { states.push(s); } });
		h.eq(wk.state(), 'off', 'wakeKeeper: off until started');
		wk.start();
		h.eq([wk.state(), f.lock.asks, f.lock.type], ['asking', 1, 'screen'], 'wakeKeeper: start asks for a screen lock');
		await settle();
		h.eq([wk.state(), wk.held()], ['held', true], 'wakeKeeper: the lock is held');
		wk.start();
		h.eq(f.lock.asks, 1, 'wakeKeeper: starting again while held asks nothing more');
		// the page is hidden: the browser lets the lock go; shown again: asked again
		f.doc.visibilityState = 'hidden';
		clockF += 5000; f.lock.live[0].release();
		f.doc.show('hidden');
		h.eq([wk.state(), f.lock.asks], ['lost', 1], 'wakeKeeper: hidden, the released lock is not asked for again yet');
		f.doc.show('visible');
		h.eq(f.lock.asks, 2, 'wakeKeeper: shown again (visibilitychange), it asks again');
		await settle();
		h.eq(wk.state(), 'held', 'wakeKeeper: and holds it again');
		// released while showing (battery saver, say): asked again at once
		clockF += 5000; f.lock.live[0].release();
		h.eq(f.lock.asks, 3, 'wakeKeeper: a release while the page shows asks again at once');
		await settle();
		h.eq(wk.state(), 'held', 'wakeKeeper: held after the release');
		// refused: tried again after retryMs
		f.lock.refuse = true;
		clockF += 5000; f.lock.live[0].release();
		await settle();
		h.eq([wk.state(), f.lock.asks, f.timers.length, f.timers[0] && f.timers[0].ms], ['denied', 4, 1, 15000], 'wakeKeeper: a refusal waits 15 s before asking again');
		f.lock.refuse = false;
		f.runTimers();
		await settle();
		h.eq([wk.state(), f.lock.asks], ['held', 5], 'wakeKeeper: the retry gets the lock');
		// three quick releases in a row: it waits instead of asking in a loop
		var g = fakes(), clock0 = 0;
		var wk2 = C.wakeKeeper({ nav: g.nav, doc: g.doc, setTimer: g.setTimer, clearTimer: g.clearTimer, now: function () { return clock0; } });
		wk2.start();
		for (var i = 0; i < 3; i++) { await settle(); g.lock.live[0].release(); }
		h.eq([g.lock.asks, wk2.state(), g.timers.length], [3, 'lost', 1], 'wakeKeeper: released three times within a second: it waits before asking again');
		await settle();
		// stop: the lock is let go and nothing asks again
		wk.stop();
		h.eq([wk.state(), f.lock.live.length], ['off', 0], 'wakeKeeper: stop lets the lock go');
		f.doc.show('hidden');
		f.doc.show('visible');
		f.runTimers();
		await settle();
		h.eq(f.lock.asks, 5, 'wakeKeeper: once stopped, showing the page asks nothing');
		wk2.stop();
		// no Wake Lock API: says so and does nothing
		var wk3 = C.wakeKeeper({ nav: {}, doc: fakes().doc });
		wk3.start();
		h.eq(wk3.state(), 'unsupported', 'wakeKeeper: a browser without the Wake Lock API: unsupported');
		wk3.stop();
		// started while hidden: waits for the page to show
		var k = fakes();
		k.doc.visibilityState = 'hidden';
		var wk4 = C.wakeKeeper({ nav: k.nav, doc: k.doc, setTimer: k.setTimer, clearTimer: k.clearTimer });
		wk4.start();
		h.eq([wk4.state(), k.lock.asks], ['lost', 0], 'wakeKeeper: started while hidden, it does not ask yet');
		k.doc.show('visible');
		await settle();
		h.eq([wk4.state(), k.lock.asks], ['held', 1], 'wakeKeeper: and asks once the page shows');
		// stopped while the request is out: the late lock is let go at once
		var m = fakes();
		var wk5 = C.wakeKeeper({ nav: m.nav, doc: m.doc, setTimer: m.setTimer, clearTimer: m.clearTimer });
		wk5.start();
		wk5.stop();
		await settle();
		h.eq([wk5.state(), m.lock.live.length], ['off', 0], 'wakeKeeper: a lock granted after stop is released');
		wk4.stop();

		// ---- logLine: Test buttons ----
		var at = new Date(2026, 9, 11, 12, 1, 33).getTime();
		h.eq([
			C.logLine({ at: at, action: 'nexttrack', handled: true, hidden: false }),
			C.logLine({ at: at, action: 'previoustrack', handled: false, hidden: true }),
			C.logLine({ at: at, action: 'seekto', handled: false, hidden: false }),
			C.logLine(null)
		], ['12:01:33 nexttrack ok', '12:01:33 previoustrack ignored: the page was hidden', '12:01:33 seekto not handled', ''], 'logLine: the time, the action, and whether the page acted on it');

		// ---- startPlan: what Start does ----
		h.eq([
			C.startPlan({ playerState: 'playing', items: 3 }),
			C.startPlan({ playerState: 'loading', items: 0 }),
			C.startPlan({ playerState: 'paused', items: 3, done: false }),
			C.startPlan({ playerState: 'idle', items: 3, done: false, hasSeed: true }),
			C.startPlan({ playerState: 'idle', items: 0, hasSeed: true }),
			C.startPlan({ playerState: 'ended', items: 3, done: true, hasSeed: true }),
			C.startPlan({ playerState: 'idle', items: 0, hasSeed: false }),
			C.startPlan(null)
		], ['keep', 'keep', 'resume', 'resume', 'radio', 'radio', 'nothing', 'nothing'], 'startPlan: keep what plays, else the queue, else a radio, else nothing');

		// ---- the New songs dial ----
		h.eq(C.RATIOS.map(function (r) { return r.name + ' ' + r.value; }), ['None 0', 'Some 0.5', 'Lots 0.8'], 'RATIOS: None, Some, Lots');
		h.eq([0, 0.5, 0.8].map(C.nextRatio), [0.5, 0.8, 0], 'nextRatio: None, Some, Lots, then None again');
		h.eq([0, 0.5, 0.8, 0.6, 1, 0.1, 'x', null].map(C.ratioName), ['None', 'Some', 'Lots', 'Some', 'Lots', 'None', 'Some', 'None'], 'ratioName: the nearest step; nonsense reads as Some');
		h.eq(C.KEYS, { fullscreen: 'carFullscreen', landscape: 'carLandscape', voice: 'carVoice', ratio: 'newRatio' }, 'KEYS: the ToyKit keys car mode reads (newRatio is the radios\' own)');

		// ---- outside a browser ----
		h.eq([C.active(), C.previewsOff(), C.enter({}), C.exit(), C.installState()], [false, false, false, false, 'menu'], 'enter, exit, active, previewsOff, installState: nothing to do outside a browser');
		var inst = await C.install();
		h.eq(inst, 'unavailable', 'install: no offer from the browser, nothing to install');

		// ---- the help text ----
		h.eq([C.HELP_STEPS.length, C.HELP_NOTES.length], [5, 3], 'HELP_STEPS, HELP_NOTES: five steps, three notes');
		h.ok(C.HELP_STEPS.concat(C.HELP_NOTES).every(function (s) { return C.HELP.indexOf(s) >= 0; }) && C.HELP.indexOf('In the car') === 0, 'HELP: the title, the steps and the notes in one text');
		h.ok(/pair/i.test(C.HELP_STEPS[0]) && /BT Audio/.test(C.HELP_STEPS[1]) && /Open True Shuffle/.test(C.HELP_STEPS[2]) && /Car mode/.test(C.HELP_STEPS[3]) && /Start/.test(C.HELP_STEPS[4]), 'HELP_STEPS: pair the phone, BT Audio, open the app, Car mode, Start');
		h.ok(/cannot choose where its sound goes/.test(C.HELP) && /Android sends all media sound to the car/.test(C.HELP) && /screen has to stay on/.test(C.HELP) && /Car mode keeps it on/.test(C.HELP), 'HELP: the page cannot pick the output; the screen must stay on and car mode keeps it on');
		h.eq(/^[\x00-\x7F]*$/.test(require('fs').readFileSync(path.join(h.HERE, 'car.js'), 'utf8')), true, 'car.js is plain ASCII');
	});
};
