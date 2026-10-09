/*
 * True Shuffle: the page. An app shell (top bar, sections, a view, the
 * now-playing panel with YouTube's player and the queue, the player bar)
 * over the core modules (config, parse, library, shuffle, store, player,
 * taxonomy, demo, yt; README.md describes them). Views are routed by the
 * hash: #/, #/search, #/songs, #/artists, #/artist/<key>, #/genres,
 * #/genre/<name>, #/family/<key>, #/browse, #/c/<facet>/<value>, #/works,
 * #/work/<name>, #/mix, #/stats, #/fix, #/settings, #/library.
 *
 * Imported titles are untrusted text: everything from YouTube or from a
 * file goes on the page through textContent (ui.js h()).
 */
(function () {
	'use strict';

	var TS = window.TrueShuffle, L = TS.library, S = TS.shuffle, Y = TS.yt, P = TS.player, Parse = TS.parse, T = TS.taxonomy, U = TS.ui;
	var h = U.h, icon = U.icon, clear = U.clear, link = U.link;
	var ID = '101-true-shuffle';
	var DOT = String.fromCharCode(0xB7), NDASH = String.fromCharCode(0x2013), ELL = String.fromCharCode(0x2026);
	var LQ = String.fromCharCode(0x201C), RQ = String.fromCharCode(0x201D), STAR = String.fromCharCode(0x2605);
	var FIXED_NOW = Date.UTC(2026, 9, 5, 19, 30, 0);
	var HOUR = 3600000;

	var thumb = ToyKit.thumb;
	var demo = thumb || ToyKit.params.get('demo') === '1';
	var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
	// Tests only: ?player=mock on localhost plays the imported library on the mock.
	function mockOnLocal() { return !demo && local && new URLSearchParams(location.search).get('player') === 'mock'; }
	var speed = Math.max(1, Math.min(2000, +ToyKit.params.get('speed') || 1));

	function now() { return thumb ? FIXED_NOW : Date.now(); }
	function $(id) { return document.getElementById(id); }

	// ---- Words -------------------------------------------------------------------------------

	function n(x) { return (+x || 0).toLocaleString('en-US'); }
	function plural(k, one, many) { return n(k) + ' ' + (k === 1 ? one : (many || one + 's')); }
	function clock(sec) { sec = Math.max(0, Math.round(+sec || 0)); var hh = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (hh ? hh + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }
	function longTime(sec) { var m = Math.round((+sec || 0) / 60); if (m < 60) return m + ' min'; var hh = Math.floor(m / 60); return hh + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
	function q(s) { return LQ + s + RQ; }
	function trackTitle(t) { return (t && (t.title || (t.raw && t.raw.title))) || 'Untitled'; }
	function trackArtist(t) { return t && t.artist ? t.artist : t && t.artistGuess ? t.artistGuess : 'Unknown artist'; }
	function isGuess(t) { return !!t && !t.artist && !!t.artistGuess; }
	function setStatus(text) { $('status').textContent = text || ''; }
	function say(text) { setStatus(text); if (text) ToyKit.toast(text); }
	function fail(err) {
		var msg = err && err.message ? err.message : String(err);
		setStatus(msg);
		if (err && err.code !== 'aborted') ToyKit.toast(msg);
	}
	function later(fn, ms) { var t = 0; return function () { clearTimeout(t); t = setTimeout(fn, ms || 0); }; }
	var collator = window.Intl && Intl.Collator ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
	function cmp(a, b) { return collator ? collator.compare(a, b) : String(a).localeCompare(String(b)); }
	function capital(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	// '2021' -> '2021', '2021-05' -> 'May 2021'
	function addedName(k) { k = String(k || ''); return k.length === 7 ? MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4) : k || 'Unknown'; }
	function addedHue(k) { var y = +String(k).slice(0, 4) || 2020; return { h: (y - 2016) * 37 % 360, s: 45 }; }
	var VERSION_NAME = { cover: 'Cover', remix: 'Remix', live: 'Live', acoustic: 'Acoustic', instrumental: 'Instrumental', karaoke: 'Karaoke', piano: 'Piano', orchestral: 'Orchestral', remaster: 'Remaster', demo: 'Demo', extended: 'Extended', edit: 'Edit', 'sped-up': 'Sped up', slowed: 'Slowed', 'tv-size': 'TV size', short: 'Short', acapella: 'A cappella', session: 'Session', language: 'Translated', alt: 'Alternate' };
	function versionWords(t) { return t && t.version ? t.version.split('+').map(function (v) { return VERSION_NAME[v] || v; }).join(', ') : ''; }
	var MOOD_HUE = { bright: 45, driving: 8, wistful: 215, tender: 150, dark: 265, quirky: 305 };
	var SCENE_HUE = { anime: 330, vn: 290, game: 160, vtuber: 190, vocaloid: 172, utaite: 350, touhou: 0, film: 30, tv: 55, stage: 15, meme: 95 };
	var LANG_HUE = { ja: 350, en: 215, ko: 260, zh: 10, fr: 230, de: 40, es: 30, la: 50, other: 120, inst: 180 };

	// ---- State ---------------------------------------------------------------------------------

	var store = null, lib = L.create(), demoInfo = null, player = null, ctl = null;
	var mockErrors = {};
	var DEFAULT_PLAN = {
		mode: 'true', playlists: [], genres: [], families: [], decades: [], artists: [], lengths: [],
		scenes: [], works: [], moods: [], langs: [], kinds: [], roles: [],
		maxTracks: null, maxMinutes: null, hours: null, keepRuns: true, blockSize: 3, clips: false, text: '', apart: true, oneVersion: false, added: [], addedFrom: '', addedTo: '', minRating: 0, channels: []
	};
	var LIST_KEYS = ['playlists', 'genres', 'families', 'decades', 'artists', 'lengths', 'scenes', 'works', 'moods', 'langs', 'kinds', 'roles', 'added', 'channels'];
	var plan = copyPlan(DEFAULT_PLAN);
	var stations = [];
	var bag = null, bagKey = '', bagRand = thumb ? S.rng('thumb') : S.cryptoRng();
	var session = { count: 0, seconds: 0 };
	var quota = null, sources = null, importing = null, mbJob = null;
	var queueMode = '';             // 'true' when the queue came from the bag, 'list' for a list played in order
	// What is playing: { label, href, patch } (patch: the plan's filters for "shuffle again").
	var context = { label: 'Your library', href: '#/songs', patch: {} };
	var prefs = { art: ToyKit.load('art', true) !== false, density: ToyKit.load('density', 'comfortable') };

	function copyPlan(p) {
		var o = {};
		for (var k in DEFAULT_PLAN) o[k] = Array.isArray(DEFAULT_PLAN[k]) ? ((p && Array.isArray(p[k])) ? p[k].slice() : []) : (p && k in p && p[k] !== undefined ? p[k] : DEFAULT_PLAN[k]);
		return o;
	}
	function planWith(patch, mode) {
		var p = copyPlan(DEFAULT_PLAN);
		p.mode = mode || plan.mode;
		['apart', 'oneVersion', 'keepRuns', 'blockSize'].forEach(function (k) { if (plan && plan[k] !== undefined) p[k] = plan[k]; });
		for (var k in patch) p[k] = Array.isArray(patch[k]) ? patch[k].slice() : patch[k];
		return p;
	}
	// The plan's choices as shuffle.js's select(). Families are their genres.
	// Clips (not music) stay out unless asked for.
	function selectOf(p) {
		var s = {};
		LIST_KEYS.forEach(function (k) { if (k !== 'families' && p[k] && p[k].length) s[k] = p[k].slice(); });
		if (p.families && p.families.length) {
			var gs = s.genres ? s.genres.slice() : [];
			p.families.forEach(function (f) { T.genresOfFamily(f, knownGenres()).forEach(function (g) { if (gs.indexOf(g) < 0) gs.push(g); }); });
			s.genres = gs;
		}
		if (p.hours > 0) s.notPlayedWithinHours = +p.hours;
		if (p.text) s.text = p.text;
		if (p.minRating > 0) s.minRating = +p.minRating;
		if (p.addedFrom) s.addedFrom = p.addedFrom;
		if (p.addedTo) s.addedTo = p.addedTo;
		if (!p.clips && !(p.kinds && p.kinds.indexOf('clip') >= 0) && !(p.genres && p.genres.indexOf('Spoken & clips') >= 0)) s.not = { kinds: ['clip'] };
		return s;
	}
	function limitsOf(p) { return { maxTracks: p.maxTracks > 0 ? +p.maxTracks : 0, maxMinutes: p.maxMinutes > 0 ? +p.maxMinutes : 0 }; }
	var ORDER = [
		{ key: 'true', icon: 'shuffle' }, { key: 'spread', icon: 'spread' }, { key: 'fresh', icon: 'fresh' }, { key: 'favourites', icon: 'heart' },
		{ key: 'neglected', icon: 'history' }, { key: 'artists', icon: 'rotate' }, { key: 'genres', icon: 'blocks' }, { key: 'newest', icon: 'newest' }, { key: 'flow', icon: 'mood' }, { key: 'original', icon: 'list' }
	];
	var MODE_LABEL = { 'true': 'True shuffle', spread: 'Spread artists', fresh: 'Fresh first', favourites: 'Favourites', neglected: 'Rediscover', artists: 'Artist rotation', genres: 'Genre blocks', newest: 'Newest first', flow: 'Mood flow', original: 'In order' };
	function modeInfo(key) {
		if (key === 'original') return { key: 'original', name: 'In order', blurb: 'The order of your playlists: oldest addition first.' };
		for (var i = 0; i < S.MODES.length; i++) if (S.MODES[i].key === key) return S.MODES[i];
		return S.MODES[0];
	}
	function modeName(key) { return MODE_LABEL[key] || modeInfo(key).name; }
	function modeIcon(key) { for (var i = 0; i < ORDER.length; i++) if (ORDER[i].key === key) return ORDER[i].icon; return 'shuffle'; }
	function chosenTracks(p) { return S.select(scopeTracks(), selectOf(p || plan), now()); }

	// ---- The index: what the views count, rebuilt after every change ------------------------------

	var memo = null;
	function dirty() { memo = null; scopeMemo = null; }
	function knownGenres() { var g = {}; L.list(lib).forEach(function (t) { t.genres.forEach(function (x) { g[x] = true; }); }); return Object.keys(g); }
	function idx() {
		if (memo) return memo;
		var m = { all: scopeTracks(), music: [], artists: {}, works: {}, genres: {}, families: {}, moods: {}, scenes: {}, langs: {}, decades: {}, addedY: {}, addedM: {}, needs: { unsure: 0, unlabelled: 0, gone: 0 } };
		function bump(map, key, t, extra) {
			var e = map[key] || (map[key] = { key: key, tracks: [], seconds: 0, plays: 0 });
			e.tracks.push(t);
			e.seconds += t.durationSec || 0;
			e.plays += t.plays || 0;
			if (extra) extra(e);
		}
		m.all.forEach(function (t) {
			if (t.kind !== 'clip') m.music.push(t);
			if (t.artistKey) bump(m.artists, t.artistKey, t, function (e) { e.names = e.names || {}; e.names[t.artist] = (e.names[t.artist] || 0) + 1; });
			if (t.work) bump(m.works, t.work, t, function (e) { e.scenes = e.scenes || {}; if (t.scene) e.scenes[t.scene] = (e.scenes[t.scene] || 0) + 1; });
			var fams = {};
			(t.genres.length ? t.genres : ['']).forEach(function (g) { if (g) { bump(m.genres, g, t); fams[T.familyOf(g)] = true; } });
			Object.keys(fams).forEach(function (f) { bump(m.families, f, t); });
			if (t.mood) bump(m.moods, t.mood, t);
			if (t.scene) bump(m.scenes, t.scene, t);
			if (t.lang) bump(m.langs, t.lang, t);
			if (t.decade) bump(m.decades, t.decade, t);
			var ak = S.addedKeys(t);
			if (ak[0] && t.kind !== 'clip') { bump(m.addedY, ak[0], t); bump(m.addedM, ak[1], t); }
			if (!t.artistKey) m.needs.unsure++;
			if (!t.labels && !Object.keys(t.userEdits).length) m.needs.unlabelled++;
			if (!L.playable(t)) m.needs.gone++;
		});
		Object.keys(m.artists).forEach(function (k) {
			var e = m.artists[k], best = '', c = 0;
			for (var s in e.names) if (e.names[s] > c) { c = e.names[s]; best = s; }
			e.name = best;
			e.native = (lib.profiles[k] && lib.profiles[k].native) || '';
			var fam = {};
			e.tracks.forEach(function (t) { var f = T.trackFamily(t); fam[f] = (fam[f] || 0) + 1; });
			e.family = Object.keys(fam).sort(function (a, b) { return fam[b] - fam[a]; })[0] || 'other';
			e.cover = coverOf(e.tracks);
		});
		Object.keys(m.works).forEach(function (k) {
			var e = m.works[k], sc = e.scenes || {};
			e.scene = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; })[0] || '';
			e.cover = coverOf(e.tracks);
		});
		return (memo = m);
	}
	// The track whose picture stands for a group: the most played, else the first added.
	function coverOf(tracks) {
		var best = null;
		tracks.forEach(function (t) { if (!L.playable(t)) return; if (!best || t.plays > best.plays || (t.plays === best.plays && L.firstAdded(t) < L.firstAdded(best))) best = t; });
		return best || tracks[0] || null;
	}
	function familyHue(key) { var f = T.family(key) || T.family('other'); return { h: f.hue, s: f.sat == null ? 55 : f.sat }; }
	function trackHue(t) { return T.hueOf((t && t.genres && t.genres[0]) || 'other'); }
	function artFor(t, cls) { var hu = trackHue(t); return U.art(t && t.id, hu.h, t ? trackTitle(t) : '', cls, prefs.art && !demo, hu.s); }

	// ---- Auth and API (never used in the demo) ------------------------------------------------------

	var ep = Y.endpoints();
	var auth = Y.createAuth({ clientId: ToyKit.load('clientId', '') || TS.config.clientId, mode: TS.config.signIn, scope: TS.config.scope, redirectUri: TS.config.redirectUri || undefined, endpoints: ep });
	var back = demo ? { status: 'none' } : auth.handleRedirect();
	var client = Y.createClient({
		getToken: auth.token,
		endpoints: ep,
		onSignedOut: function () { auth.forget(); },
		onQuota: function (units) {
			quota = Y.tallyQuota(quota, units, Date.now());
			if (store) store.set('quota', quota);
			if (route.parts[0] === 'settings') renderQuota();
		}
	});

	// ---- The player and the queue -------------------------------------------------------------------

	// What the player is doing, shown over the video box: loading, or why it
	// could not start (a blocker, the network), with a way to try again.
	var playerMsgTimer = 0, playerFailed = false;
	function playerMessage(kind, text, actions) {
		var box = $('video'), m = $('player-msg');
		clearTimeout(playerMsgTimer);
		if (!kind) { if (m) m.parentNode.removeChild(m); return; }
		if (!m) { m = h('div', { class: 'ts-player-msg', id: 'player-msg', role: 'status' }); box.appendChild(m); }
		m.className = 'ts-player-msg is-' + kind;
		clear(m);
		m.appendChild(h('p', { text: text }));
		if (actions) m.appendChild(h('div', { class: 'ts-row-btns' }, actions));
	}
	function blockedHelp(why, detail) {
		var id = ctl && ctl.current();
		var acts = [h('button', { class: 'kit-btn small primary', text: 'Try again', on: { click: function () { location.reload(); } } })];
		if (id && U.YT_ID.test(id)) acts.push(h('a', { class: 'kit-btn small', href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noopener', text: 'Open on YouTube' }));
		var tooSmall = /^box/.test(detail || '');
		playerMessage('error', why + (tooSmall ? ' YouTube asks for a player of at least 200 by 200 pixels, and the box was smaller. Make the window wider or zoom out, then try again.' : ' Something in this browser may be blocking YouTube: an ad or tracker blocker (uBlock Origin, AdGuard, Brave Shields), strict tracking protection (Firefox, Edge), or a filtering DNS. Allow youtube.com and youtube-nocookie.com on this site, then try again.'), acts);
		playerDiagnosis(detail);
	}
	// One line of facts for whoever helps: what failed, the box, the script, whether youtube.com answers.
	function playerDiagnosis(detail) {
		var r = $('player').getBoundingClientRect(), ua = navigator.userAgent;
		function has(s) { return ua.indexOf(s) >= 0; }
		var br = has('Edg/') ? 'Edge' : has('OPR/') ? 'Opera' : has('Firefox/') ? 'Firefox' : has('Chrome/') ? (navigator.brave ? 'Brave' : 'Chrome') : has('Safari/') ? 'Safari' : 'other';
		var vm = /(?:Edg|OPR|Firefox|Chrome|Version)[/]([0-9]+)/.exec(ua), v = vm ? vm[1] : '';
		var facts = [detail || 'no detail', 'box ' + Math.round(r.width) + 'x' + Math.round(r.height), 'YT ' + (window.YT && window.YT.Player ? 'loaded' : 'missing'), br + ' ' + v, 'window ' + window.innerWidth + 'x' + window.innerHeight];
		function show(extra) {
			var m = $('player-msg');
			if (!m) return;
			var old = m.querySelector('.ts-diag');
			if (old) old.parentNode.removeChild(old);
			m.appendChild(h('p', { class: 'ts-diag', text: 'Details: ' + facts.concat(extra ? [extra] : []).join(' ' + DOT + ' ') }));
		}
		show('checking youtube.com' + ELL);
		var t0 = Date.now();
		fetch('https://www.youtube.com/iframe_api', { mode: 'no-cors', cache: 'no-store' }).then(function () { show('youtube.com reachable (' + (Date.now() - t0) + ' ms)'); }, function () { show('youtube.com NOT reachable: blocked or offline'); });
	}
	function watchPlayerStart() {
		if (demo || mockOnLocal()) return;
		playerMessage('loading', 'Loading the YouTube player' + ELL);
		playerMsgTimer = setTimeout(function () {
			if (player.state() === 'playing' || player.state() === 'paused') return;
			if (!window.YT || !window.YT.Player) blockedHelp('The YouTube player script has not arrived after 8 seconds.');
			else playerMessage('loading', 'The YouTube player is taking long to start' + ELL);
		}, 8000);
	}

	// A player that builds the real one (YouTube, or the mock) on the first
	// load(), so nothing is fetched from YouTube before the reader presses Play.
	function lazyPlayer() {
		var real = null, subs = [], wantVol = ToyKit.load('volume', null), wantMute = ToyKit.load('muted', false);
		function make() {
			if (real) return real;
			document.body.classList.add('has-player');
			var box = $('player'), poster = $('poster');
			if (poster && poster.parentNode) poster.parentNode.removeChild(poster);
			watchPlayerStart();
			if (demo || mockOnLocal()) {
				real = P.create({
					kind: 'mock', container: box, auto: !thumb, speed: speed,
					durationOf: function (id) { var t = lib.tracks[id]; return t && t.durationSec ? t.durationSec : 180; },
					errorOf: function (id) { return mockErrors[id]; },
					titleOf: function (id) { var t = lib.tracks[id]; return t ? trackArtist(t) + ' ' + NDASH + ' ' + trackTitle(t) : id; }
				});
			} else {
				real = P.create({ kind: 'youtube', container: box });
			}
			subs.forEach(function (s) { s.off = real.on(s.name, s.fn); });
			if (real.volume && wantVol != null) real.volume(wantVol);
			if (real.muted && wantMute) real.muted(true);
			return real;
		}
		return {
			kind: 'lazy',
			on: function (name, fn) {
				var s = { name: name, fn: fn, off: real ? real.on(name, fn) : null };
				subs.push(s);
				return function () { subs = subs.filter(function (x) { return x !== s; }); if (s.off) s.off(); };
			},
			load: function (id, o) { return make().load(id, o); },
			play: function () { if (real) real.play(); },
			pause: function () { if (real) real.pause(); },
			stop: function () { if (real) real.stop(); },
			seek: function (sec) { if (real) real.seek(sec); },
			time: function () { return real ? real.time() : { current: 0, duration: 0 }; },
			listened: function () { return real ? real.listened() : 0; },
			state: function () { return real ? real.state() : 'idle'; },
			id: function () { return real ? real.id() : null; },
			real: function () { return real; },
			volume: function (v) { if (v != null) wantVol = v; return real && real.volume ? real.volume(v) : (wantVol == null ? 100 : wantVol); },
			muted: function (m) { if (m != null) wantMute = !!m; return real && real.muted ? real.muted(m) : !!wantMute; },
			destroy: function () { if (real) real.destroy(); }
		};
	}

	var refusals = [], pauseOnStart = false;
	function makeController(state) {
		if (ctl) ctl.destroy();
		ctl = P.controller({
			player: player,
			state: state,
			now: now,
			onChange: function (st, why) {
				if (!thumb) store.set('queue', st);
				afterQueueChange(why);
			},
			onListened: function (id, info) {
				refusals = [];
				var t = L.recordPlay(lib, id, info);
				if (!t) return;
				store.putTracks([t]);
				var he = { id: id, at: info.at, kind: info.completed || (t.durationSec && info.listenedSec >= t.durationSec / 2) ? 'play' : 'skip', listenedSec: info.listenedSec };
				store.addHistory(he);
				histCache.unshift(he);
				dirty();
				queueSync();
				if (sleep && sleep.end === 'track' && sleep.id === id && info.completed) { pauseOnStart = true; sleep = null; renderSleep(); }
			},
			onUnplayable: function (id, code) {
				var t = L.markUnplayable(lib, id, code, now());
				if (t) store.putTracks([t]);
				refusals.push(code);
				if (refusals.length > 5) refusals.shift();
				if (queueMode === 'true' && bag) ensureBag().catch(fail);
				dirty();
				say('Skipped ' + q(trackTitle(t)) + ': ' + (P.ERROR_TEXT[code] || 'it cannot be played.'));
			},
			onError: function (id, code, message, detail) { refusals.push(0); if (refusals.length > 5) refusals.shift(); setStatus(message || 'This track could not be played.'); if (code === 'api' || code === 'too-small') { playerFailed = true; blockedHelp(message || 'The player could not start.', detail || code); } },
			onNeedMore: function () { return queueMode === 'true' && bag ? bagDraw(5) : []; },
			onHalt: function (reason) {
				pauseOnStart = false;
				if (reason === 'finished') say('That was the last track. Press Shuffle again for more.');
				else if (reason === 'errors') say(haltReason());
				else { say('The YouTube player could not be started here.'); if (!playerFailed) blockedHelp('The YouTube player could not be loaded.'); playerFailed = false; }
				renderTransport();
			}
		});
		return ctl;
	}
	function haltReason() {
		var last = refusals.slice(-5), head = 'Five tracks in a row could not be played, so playback stopped. ';
		var embed = last.filter(function (c) { return c === 101 || c === 150; }).length, gone = last.filter(function (c) { return c === 100; }).length;
		refusals = [];
		if (last.length >= 5 && embed === last.length) return head + 'Their owners do not allow them to be played on other sites.';
		if (last.length >= 5 && gone === last.length) return head + 'They were removed or made private.';
		if (last.length >= 5 && embed + gone === last.length) return head + 'YouTube refused each of them.';
		return head + 'Is the network down?';
	}

	// A new queue. With play, the first track starts now; otherwise it waits for Play.
	function setQueue(ids, play, index) {
		var old = ctl ? ctl.state() : S.queueInit();
		if (play) { showDock(); ctl.load(ids, index || 0); return; }
		makeController({ items: ids.slice(), index: ids.length ? (index || 0) : -1, history: old.history.slice(), done: false, repeat: old.repeat });
		if (!thumb) store.set('queue', ctl.state());
		afterQueueChange('load');
	}
	// Keep the track that is on, replace what comes after it.
	function replaceUpcoming(ids, play) {
		var cur = ctl.current(), started = player.id() != null, fromBag = queueMode === 'true';
		queueMode = plan.mode === 'true' ? 'true' : 'plan';
		if (context.list) { context = Object.keys(context.patch || {}).length ? { label: context.label, href: context.href, patch: context.patch } : { label: 'Your library', href: '#/songs', patch: {} }; if (!thumb) store.set('context', context); }
		if (cur != null && started && !play) {
			if (fromBag) returnToBag(S.upcoming(ctl.state()));
			ids = ids.filter(function (id) { return id !== cur; });
			ctl.clearUpcoming();
			if (ids.length) ctl.enqueue(ids); else afterQueueChange('plan');
		} else {
			if (fromBag) returnToBag(S.upcoming(ctl.state()).concat(cur != null && !started ? [cur] : []));
			setQueue(ids, play);
		}
	}
	// The YouTube player must be visible at its full size before it is built.
	function showDock() { document.body.classList.add('has-player'); }

	// ---- The bag (the endless true shuffle) ---------------------------------------------------------

	function ensureBag() {
		var sel = selectOf(plan), key = 'bag:' + S.signature(sel) + (focus ? ':' + focus : ''), chosen = S.select(scopeTracks(), sel, now());
		if (bag && bagKey === key) { bag = S.bagSync(bag, chosen, bagRand).bag; return saveBag(); }
		if (bag && bagKey && bagKey !== key && queueMode === 'true' && ctl) returnToBag(S.upcoming(ctl.state()));
		var load = thumb ? Promise.resolve(null) : store.get(key, null);
		return load.then(function (saved) {
			bag = saved && saved.order ? S.bagSync(saved, chosen, bagRand).bag : S.bagCreate(chosen, bagRand);
			bagKey = key;
			return saveBag();
		});
	}
	function runMembers(b, id) {
		var t = lib.tracks[id], key = t && t.run && t.run.key;
		if (!key) return null;
		var parts = b.order.map(function (x) { return lib.tracks[x]; }).filter(function (m) { return m && m.run && m.run.key === key; });
		if (parts.length < 2 || parts.length > S.MAX_RUN) return null;
		parts.sort(function (a, c) { return a.run.n - c.run.n || (a.id < c.id ? -1 : 1); });
		return parts.map(function (m) { return m.id; });
	}
	function saveBag() { return thumb || !bag ? Promise.resolve() : store.set(bagKey, bag); }
	function bagDraw(k) {
		var out = [], lim = limitsOf(plan), guard = 0, songs = {};
		if (plan.oneVersion && bag) S.bagPlayed(bag).forEach(function (id) { if (lib.tracks[id]) songs[S.songKey(lib.tracks[id])] = true; });
		while (bag && out.length < k && guard++ < 10000) {
			if (lim.maxTracks && session.count >= lim.maxTracks) break;
			var r = S.bagNext(bag, bagRand);
			if (r.id == null) break;
			if (plan.keepRuns) {
				var members = runMembers(r.bag, r.id);
				if (members) {
					var rr = S.bagRunDraw(r.bag, members);
					if (rr.id == null) { bag = rr.bag; continue; }
					r = rr;
				}
			}
			if (plan.oneVersion && lib.tracks[r.id]) {
				var sk = S.songKey(lib.tracks[r.id]);
				if (songs[sk]) { bag = r.bag; continue; }
				songs[sk] = true;
			}
			var d = (lib.tracks[r.id] && lib.tracks[r.id].durationSec) || 0;
			if (lim.maxMinutes && session.seconds + d > lim.maxMinutes * 60) break;
			bag = r.bag;
			out.push(r.id);
			session.count++;
			session.seconds += d;
		}
		saveBag();
		return out;
	}
	function returnToBag(ids) {
		if (!bag || !ids.length) return;
		var drawn = {}, backIds = [];
		S.bagPlayed(bag).forEach(function (id) { drawn[id] = true; });
		ids.forEach(function (id) { if (drawn[id] && backIds.indexOf(id) < 0) backIds.push(id); });
		if (!backIds.length) return;
		bag = S.bagReturn(bag, backIds, bagRand);
		session.count = Math.max(0, session.count - backIds.length);
		saveBag();
	}

	// ---- Plans: what plays next ---------------------------------------------------------------------

	function originalOrder(chosen) {
		var byPl = plan.playlists.length ? plan.playlists : Object.keys(lib.playlists);
		var out = [], seen = {};
		byPl.forEach(function (pl) {
			chosen.filter(function (t) { return t.playlists.indexOf(pl) >= 0; }).sort(function (a, b) {
				var x = a.addedAt[pl] || '', y = b.addedAt[pl] || '';
				return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1);
			}).forEach(function (t) { if (!seen[t.id]) { seen[t.id] = true; out.push(t.id); } });
		});
		chosen.forEach(function (t) { if (!seen[t.id]) out.push(t.id); });
		return S.limit(out, lib.tracks, limitsOf(plan)).order;
	}
	function buildOrder() {
		if (plan.mode === 'original') return originalOrder(chosenTracks());
		var cur = ctl && ctl.current() && lib.tracks[ctl.current()];
		var built = S.build(scopeTracks(), {
			select: selectOf(plan), mode: plan.mode, blockSize: +plan.blockSize || 3, keepRuns: !!plan.keepRuns, apart: plan.apart !== false, oneVersion: !!plan.oneVersion,
			limits: limitsOf(plan), seed: thumb ? 'thumb' : undefined
		}, { now: now(), after: cur ? S.artistKey(cur) : undefined });
		return built.order;
	}
	// Apply the plan: the track that is on stays (unless play), what follows is new.
	function applyPlan(opts) {
		opts = opts || {};
		if (!thumb) store.set('plan', plan);
		session = { count: 0, seconds: 0 };
		var go = plan.mode === 'true' ? ensureBag().then(function () {
			if (opts.reshuffle) {
				var started = player.id() != null, up = S.upcoming(ctl.state());
				if (!started && ctl.current() != null) up = up.concat([ctl.current()]);
				if (queueMode === 'true') returnToBag(up);
				queueMode = 'true';
				var played = S.bagPlayed(bag), rest = S.trueShuffle(S.bagRemaining(bag), bagRand);
				var gone = bag.gone;
				bag = { v: 1, order: played.concat(rest), pos: played.length, cycle: bag.cycle, last: bag.last };
				if (gone && gone.length) bag.gone = gone.slice();
				var cur = ctl.current();
				ctl.clearUpcoming();
				var ids = bagDraw(8).filter(function (id) { return id !== cur; });
				if (started && cur != null) { if (ids.length) ctl.enqueue(ids); else afterQueueChange('plan'); }
				else setQueue(ids, opts.play);
				return;
			}
			replaceUpcoming(bagDraw(8), opts.play);
		}) : Promise.resolve().then(function () { replaceUpcoming(buildOrder(), opts.play); });
		return go.then(function () {
			if (!thumb) store.set('context', context);
			renderQueue();
			renderBar();
			if (route.parts[0] !== 'map' && route.parts[0] !== 'label') redrawView();
			if (opts.say) say(opts.say);
		}).catch(fail);
	}
	// Shuffle a collection: its filters, the current shuffle mode, from now.
	function shuffleThese(patch, ctx, mode) {
		if (!L.list(lib).length) return;
		var m = mode || (plan.mode === 'original' ? 'true' : plan.mode);
		plan = planWith(patch || {}, m);
		context = { label: ctx.label, href: ctx.href, patch: patch || {} };
		if (!chosenTracks().length) { say('Nothing playable here.'); return; }
		return applyPlan({ play: true });
	}
	// Play a list in its order, starting at index.
	function playIds(ids, index, ctx) {
		var ok = [], at = 0;
		ids.forEach(function (id, i) { if (lib.tracks[id] && L.playable(lib.tracks[id]) && !lib.tracks[id].blocked) { if (i === index) at = ok.length; ok.push(id); } else if (i === index) at = ok.length; });
		if (!ok.length) { say('Nothing playable here.'); return; }
		if (queueMode === 'true') returnToBag(S.upcoming(ctl.state()));
		queueMode = 'list';
		context = { label: ctx.label, href: ctx.href, patch: ctx.patch || {}, list: true };
		if (!thumb) store.set('context', context);
		setQueue(ok, true, Math.min(at, ok.length - 1));
	}
	function queueNext(ids) {
		ids = ids.filter(function (id) { return lib.tracks[id] && L.playable(lib.tracks[id]); });
		if (!ids.length) { say('Nothing playable in that choice.'); return; }
		if (ctl.current() == null) setQueue(ids, false); else ctl.playNext(ids);
		ToyKit.toast(ids.length === 1 ? trackTitle(lib.tracks[ids[0]]) + ' plays next.' : plural(ids.length, 'track') + ' play next.');
	}
	function queueLater(ids) {
		ids = ids.filter(function (id) { return lib.tracks[id] && L.playable(lib.tracks[id]); });
		if (!ids.length) { say('Nothing playable in that choice.'); return; }
		if (ctl.current() == null) setQueue(ids, false); else ctl.enqueue(ids);
		ToyKit.toast(plural(ids.length, 'track') + ' added to the queue.');
	}

	// Radio: songs that sound like this one. Shared genres count most, then
	// the same mood, scene, language and family; the same artist a little
	// (but the spread keeps them apart). Clips never.
	function radioIds(seed, count) {
		var sg = seed.genres || [], fam = T.trackFamily(seed), r = thumb ? S.rng('radio') : S.cryptoRng();
		var scored = [];
		scopeTracks().forEach(function (t) {
			if (t.id === seed.id || t.blocked || !L.playable(t) || t.kind === 'clip') return;
			var s = 0;
			(t.genres || []).forEach(function (g) { if (sg.indexOf(g) >= 0) s += 3; });
			if (seed.mood && t.mood === seed.mood) s += 2;
			if (seed.scene && t.scene === seed.scene) s += 1.5;
			if (seed.lang && t.lang === seed.lang) s += 1;
			if (T.trackFamily(t) === fam) s += 1;
			if (seed.artistKey && t.artistKey === seed.artistKey) s += 2;
			if (seed.work && t.work === seed.work) s += 1;
			if (s >= 3) scored.push({ t: t, s: s + r() * 2.5 });
		});
		scored.sort(function (a, b) { return b.s - a.s; });
		var pool = scored.slice(0, count || 120).map(function (x) { return x.t; });
		return [seed.id].concat(S.spreadShuffle(pool, r, { after: S.artistKey(seed) }));
	}
	function startRadio(t) {
		if (!t) return;
		playIds(radioIds(t), 0, { label: 'Radio: ' + trackTitle(t), href: link('track', t.id) });
	}
	function artistRadio(key) {
		var a = idx().artists[key];
		if (!a) return;
		var seedT = coverOf(a.tracks), ids = radioIds(seedT, 160), own = a.tracks.filter(function (t) { return L.playable(t) && !t.blocked; }).map(function (t) { return t.id; });
		// half the artist, half what sounds like them, spread apart
		var r = S.cryptoRng(), mixed = S.trueShuffle(own, r).slice(0, 25).concat(ids.slice(0, 60));
		var uniq = []; mixed.forEach(function (id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
		var order = S.spreadShuffle(uniq.map(function (id) { return lib.tracks[id]; }), r, {});
		playIds(order, 0, { label: 'Radio: ' + a.name, href: link('artist', key) });
	}

	// ---- After changes ------------------------------------------------------------------------------

	function afterQueueChange() {
		renderBar();
		renderNowInfo();
		renderQueue();
		markPlaying();
		renderRepeat();
		if (route.parts[0] === 'map' && mapRedraw) mapRedraw();
	}
	function saveIds(ids) {
		var list = [];
		(ids || []).forEach(function (id) { if (lib.tracks[id]) list.push(lib.tracks[id]); });
		return store.putTracks(list);
	}
	function saveMeta() { return store.saveLibraryMeta(L.meta(lib)); }
	var redrawView = later(function () { renderView(true); renderNav(); }, 120);
	function changed(ids, meta) {
		dirty();
		var p = saveIds(ids);
		if (meta) p = p.then(saveMeta);
		if (queueMode === 'true' && bag) ensureBag();
		renderBar();
		renderNowInfo();
		renderQueue();
		redrawView();
		queueSync();
		return p.catch(fail);
	}

	// ---- The shell: sections, routing ----------------------------------------------------------------

	var NAV = [
		{ key: '', label: 'Home', icon: 'home' },
		{ key: 'search', label: 'Search', icon: 'search' },
		{ sep: 'Library' },
		{ key: 'songs', label: 'Songs', icon: 'songs' },
		{ key: 'artists', label: 'Artists', icon: 'artist' },
		{ key: 'genres', label: 'Genres', icon: 'genre' },
		{ key: 'browse', label: 'Moods & scenes', icon: 'mood' },
		{ key: 'works', label: 'Anime, games & stage', icon: 'works' },
		{ key: 'map', label: 'Map', icon: 'map' },
		{ key: 'discover', label: 'Discover', icon: 'compass' },
		{ sep: 'Listen' },
		{ key: 'lists', label: 'Playlists', icon: 'list' },
		{ key: 'liked', label: 'Liked songs', icon: 'heart' },
		{ key: 'mix', label: 'Mix builder', icon: 'mix' },
		{ key: 'history', label: 'History', icon: 'history' },
		{ key: 'stats', label: 'Your numbers', icon: 'stats' },
		{ key: 'label', label: 'Quick labeller', icon: 'edit' },
		{ key: 'fix', label: 'Needs attention', icon: 'fix', badge: true },
		{ key: 'settings', label: 'Settings', icon: 'settings' }
	];
	var TABS = [
		{ key: '', label: 'Home', icon: 'home' }, { key: 'search', label: 'Search', icon: 'search' },
		{ key: 'library', label: 'Library', icon: 'songs' }, { key: 'mix', label: 'Mix', icon: 'mix' }, { key: 'queue', label: 'Queue', icon: 'queue' }
	];
	var SECTION_OF = { channel: 'artists', artist: 'artists', genre: 'genres', family: 'genres', c: 'browse', work: 'works', track: 'songs', list: 'lists' };
	var route = U.parseHash(location.hash);
	function section() { var p = route.parts[0] || ''; return SECTION_OF[p] || p; }

	function renderNav() {
		var ul = $('nav'), sec = section(), need = idx().needs.unsure;
		clear(ul);
		NAV.forEach(function (it) {
			if (it.sep) { ul.appendChild(h('li', { class: 'ts-nav-sep', text: it.sep })); return; }
			var a = h('a', { class: 'ts-nav-a' + (sec === it.key ? ' is-on' : ''), href: '#/' + it.key, aria: { current: sec === it.key ? 'page' : null } });
			a.appendChild(icon(it.icon));
			a.appendChild(h('span', { class: 'ts-nav-label', text: it.label }));
			if (it.badge && need && L.list(lib).length) a.appendChild(h('span', { class: 'ts-badge', text: need > 999 ? '999+' : String(need), title: plural(need, 'track') + ' without a sure artist' }));
			ul.appendChild(h('li', null, a));
		});
		var tb = $('tabbar');
		clear(tb);
		TABS.forEach(function (it) {
			var on = it.key === 'library' ? ['songs', 'artists', 'genres', 'browse', 'works', 'stats', 'fix', 'settings', 'library', 'lists', 'map', 'history', 'label', 'discover'].indexOf(sec) >= 0 : it.key === 'queue' ? document.body.classList.contains('sheet-open') : sec === it.key;
			var a = h('a', { class: 'ts-tab-a' + (on ? ' is-on' : ''), href: it.key === 'queue' ? '#' : '#/' + it.key });
			a.appendChild(icon(it.icon));
			a.appendChild(h('span', { text: it.label }));
			if (it.key === 'queue') a.addEventListener('click', function (e) { e.preventDefault(); toggleSheet(); });
			tb.appendChild(a);
		});
		renderStations();
	}
	function renderStations() {
		var ul = $('stations');
		clear(ul);
		renderFocusBtn();
		if (!lists.length) { ul.appendChild(h('li', { class: 'ts-side-empty' }, ['Work with part of your library: ', h('a', { href: '#/lists', text: 'make or pick a playlist' }), '.'])); return; }
		lists.forEach(function (li) {
			var a = h('a', { class: 'ts-station' + (focus === li.id ? ' is-focused' : '') + (route.parts[0] === 'list' && route.parts[1] === li.id ? ' is-on' : ''), href: link('list', li.id), title: li.name, data: { list: li.id } }, [U.swatch(li.kind === 'manual' ? 200 : 265, li.name, 'ts-station-art'), h('span', { text: li.name }), focus === li.id ? icon('mix', 'ts-station-focus') : null]);
			if (li.kind === 'manual') dropTarget(a, function (ids) { ids.forEach(function (id) { if (li.ids.indexOf(id) < 0) li.ids.push(id); }); saveLists(); if (focus === li.id) { dirty(); redrawView(); } say(plural(ids.length, 'song') + ' added to ' + q(li.name) + '.'); });
			ul.appendChild(h('li', null, a));
		});
	}
	function renderStationsOld(stations) {
		var ul = $('stations');
		stations.forEach(function (st, i) {
			var b = h('button', { class: 'ts-station', title: 'Play ' + st.name, on: { click: function () { playStation(st); } } }, [U.swatch(stationHue(st), st.name, 'ts-station-art'), h('span', { text: st.name })]);
			b.addEventListener('contextmenu', function (e) {
				e.preventDefault();
				U.openMenu({ x: e.clientX, y: e.clientY }, [
					{ label: 'Play', icon: 'play', onSelect: function () { playStation(st); } },
					{ label: 'Open in the mix builder', icon: 'mix', onSelect: function () { draft = copyPlan(st.plan); location.hash = '#/mix'; } },
					{ label: 'Delete station', icon: 'close', onSelect: function () { stations.splice(i, 1); store.set('presets', stations); renderStations(); } }
				]);
			});
			ul.appendChild(h('li', null, b));
		});
	}
	function stationHue(st) { var f = st.plan.families && st.plan.families[0]; return f ? familyHue(f).h : (st.plan.genres && st.plan.genres[0] ? T.hueOf(st.plan.genres[0]).h : 200); }
	function playStation(st) {
		plan = copyPlan(st.plan);
		context = { label: 'Station: ' + st.name, href: '#/mix', patch: patchOf(st.plan) };
		applyPlan({ play: true, say: 'Playing ' + q(st.name) + '.' });
	}
	function patchOf(p) { var o = {}; LIST_KEYS.forEach(function (k) { if (p[k] && p[k].length) o[k] = p[k].slice(); }); ['maxTracks', 'maxMinutes', 'hours', 'clips', 'text', 'oneVersion', 'addedFrom', 'addedTo', 'minRating'].forEach(function (k) { if (p[k]) o[k] = p[k]; }); if (p.apart === false) o.apart = false; return o; }

	var scrollMemo = {};
	function onRoute() {
		var prevKey = route.path + '?' + route.query.toString();
		scrollMemo[prevKey] = $('main').scrollTop;
		route = U.parseHash(location.hash);
		if (previewAudio) stopPreview();
		closeSheet();
		U.closeMenu();
		if (route.parts[0] !== 'search' && document.activeElement !== $('search')) $('search').value = '';
		renderView(false);
		renderNav();
	}
	// Draw the current view. keep: a redraw after a change (keep the scroll).
	var liveLists = [];
	function renderView(keep) {
		var main = $('main'), view = $('view'), top = main.scrollTop;
		var key = route.path + '?' + route.query.toString();
		listSel = null;
		labelKeys = null;
		mapRedraw = null;
		clear(view);
		liveLists = liveLists.filter(function (v) { if (v.node.isConnected) return true; v.destroy(); return false; });
		view.classList.remove('is-map');
		var p = route.parts, name = p[0] || '';
		if (focus && listById(focus) && name !== 'list' && name !== 'lists' && name !== 'settings') {
			var fli = listById(focus);
			view.appendChild(h('div', { class: 'ts-focusbar' }, [icon('mix'), h('span', null, ['Inside ', h('a', { href: link('list', fli.id), text: fli.name }), ' ' + DOT + ' ' + plural(scopeTracks().length, 'song')]), h('button', { class: 'ts-link-btn', text: 'Show everything', on: { click: function () { setFocus(null); } } })]));
		}
		var fn = VIEWS[name] || viewHome;
		try { fn(view, p.slice(1), route.query); } catch (e) { view.appendChild(h('p', { class: 'ts-empty', text: 'This page could not be drawn: ' + (e && e.message) })); if (window.console) console.error(e); }
		main.scrollTop = keep ? top : (scrollMemo[key] || 0);
		if (!keep && !thumb) {
			var hh = view.querySelector('h1');
			document.title = (hh ? hh.textContent + ' ' + DOT + ' ' : '') + 'True Shuffle';
		}
		markPlaying();
	}

	// ---- The player bar ------------------------------------------------------------------------------

	function renderBar() {
		var box = $('bar-track'), id = ctl ? ctl.current() : null, t = id ? lib.tracks[id] : null;
		clear(box);
		if (t) {
			box.appendChild(artFor(t, 'ts-bar-art'));
			var txt = h('div', { class: 'ts-bar-text' });
			txt.appendChild(h('button', { class: 'ts-bar-title', text: trackTitle(t), title: 'Show the queue', on: { click: toggleSheet } }));
			txt.appendChild(artistLinks(t, 'ts-bar-artist'));
			box.appendChild(txt);
		} else {
			box.appendChild(h('div', { class: 'ts-bar-text' }, [h('span', { class: 'ts-bar-title is-empty', text: L.list(lib).length ? 'Nothing playing' : 'No music yet' }), h('span', { class: 'ts-bar-artist', text: L.list(lib).length ? 'Pick something, or press play for a true shuffle' : '' })]));
		}
		renderModePill();
		renderLike();
		$('btn-edit-now').disabled = !t;
		renderTransport();
		renderPoster(t);
		mediaSession(t);
	}
	function renderTransport() {
		var st = player ? player.state() : 'idle', playing = st === 'playing' || st === 'loading';
		var b = $('btn-toggle');
		b.classList.toggle('is-playing', playing);
		U.setIcon(b, playing ? 'pause' : 'play');
		b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
		var s = ctl ? ctl.state() : null;
		$('btn-prev').disabled = !s || s.index <= 0;
		$('btn-next').disabled = !s || !s.items.length || s.index >= s.items.length - 1 && queueMode !== 'true';
		b.disabled = !L.list(lib).length;
		document.body.classList.toggle('is-playing', playing);
		if ('mediaSession' in navigator && !thumb) { try { navigator.mediaSession.playbackState = playing ? 'playing' : (st === 'paused' ? 'paused' : 'none'); } catch (e) { /* not supported */ } }
	}
	var seeking = false;
	function renderTime() {
		var tm = player ? player.time() : { current: 0, duration: 0 };
		var id = ctl && ctl.current(), t = id && lib.tracks[id];
		var dur = tm.duration || (t && t.durationSec) || 0;
		$('time-cur').textContent = clock(tm.current);
		$('time-dur').textContent = clock(dur);
		var r = $('seek');
		r.max = Math.max(1, Math.round(dur));
		if (!seeking) r.value = Math.round(tm.current);
		r.disabled = !player || player.state() === 'idle';
		r.style.setProperty('--p', (dur ? Math.min(100, 100 * tm.current / dur) : 0) + '%');
		r.setAttribute('aria-valuetext', clock(tm.current) + ' of ' + clock(dur));
	}
	function renderPoster(t) {
		var art = $('poster-art'), text = $('poster-text');
		if (!art) return;
		clear(art);
		if (t) art.appendChild(artFor(t, 'ts-poster-img'));
		text.textContent = t ? (demo ? 'Press play (demo, no sound)' : 'Press play to load YouTube\'s player') : (L.list(lib).length ? 'Press play for a true shuffle' : 'Nothing to play yet');
	}
	function artistLinks(t, cls) {
		var span = h('span', { class: cls });
		if (t.artistKey) span.appendChild(h('a', { href: link('artist', t.artistKey), text: t.artist }));
		else span.appendChild(h('span', { class: isGuess(t) ? 'ts-guess' : 'ts-muted', text: trackArtist(t), title: isGuess(t) ? 'The channel; the artist is not sure yet' : null }));
		if (t.origArtist && t.origArtist !== t.artist) span.appendChild(h('span', { class: 'ts-muted', text: ' ' + DOT + ' orig. ' + t.origArtist }));
		return span;
	}

	function togglePlay() {
		if (!ctl) return;
		var s = ctl.state();
		if (!s.items.length || s.done) {
			if (!L.list(lib).length) return;
			if (!context.label) context = { label: 'Your library', href: '#/songs', patch: {} };
			showDock();
			applyPlan({ play: true });
			return;
		}
		showDock();
		ctl.toggle();
		renderTransport();
	}
	function goNext() { if (ctl) ctl.next(); }
	function goPrev() {
		if (!ctl) return;
		if (player.time().current > 5 && player.state() !== 'idle') { player.seek(0); return; }
		ctl.previous();
	}
	function reshuffle() {
		if (!ctl) return;
		if (queueMode === 'list') {
			var st = ctl.state(), up = S.upcoming(st);
			if (up.length < 2) { say('Nothing left to shuffle.'); return; }
			var mixed = S.spreadShuffle(up.map(function (id) { return lib.tracks[id]; }).filter(Boolean), S.cryptoRng(), {});
			ctl.clearUpcoming();
			ctl.enqueue(mixed);
			say('Shuffled what comes next.');
			return;
		}
		applyPlan({ reshuffle: true, say: 'Shuffled again.' });
	}
	function modeMenuOld(anchor) {
		var items = [{ heading: 'Next tracks, chosen by' }];
		ORDER.forEach(function (o) {
			items.push({ label: modeName(o.key), icon: o.icon, checked: queueMode !== 'list' && plan.mode === o.key, onSelect: function () { setMode(o.key); } });
		});
		items.push({ sep: true });
		items.push({ label: 'Mix builder' + ELL, icon: 'mix', onSelect: function () { location.hash = '#/mix'; } });
		U.openMenu(anchor, items, { label: 'How the next tracks are chosen', focusChecked: true });
	}
	function setMode(key) {
		var patch = context.patch || {};
		plan = planWith(patch, key);
		var ctxLabel = context.label || 'Your library';
		context = { label: ctxLabel.replace(/^Radio: /, ''), href: context.href, patch: patch };
		applyPlan({ say: modeName(key) + ' from the next track on.' });
	}

	var mediaReady = false;
	function mediaSession(t) {
		if (thumb || !('mediaSession' in navigator)) return;
		try {
			if (!mediaReady) {
				mediaReady = true;
				var ms = navigator.mediaSession;
				ms.setActionHandler('play', function () { if (player.state() !== 'playing') togglePlay(); });
				ms.setActionHandler('pause', function () { if (player.state() === 'playing') togglePlay(); });
				ms.setActionHandler('nexttrack', goNext);
				ms.setActionHandler('previoustrack', goPrev);
			}
			if (t && window.MediaMetadata) {
				var md = { title: trackTitle(t), artist: trackArtist(t), album: t.work || (demo ? 'True Shuffle demo' : 'True Shuffle') };
				if (prefs.art && !demo && U.YT_ID.test(t.id)) md.artwork = [{ src: 'https://i.ytimg.com/vi/' + t.id + '/mqdefault.jpg', sizes: '320x180', type: 'image/jpeg' }];
				navigator.mediaSession.metadata = new MediaMetadata(md);
			}
		} catch (e) { /* the browser does not hand these buttons to the page */ }
	}

	// ---- Now playing and the queue ------------------------------------------------------------------

	function chip(text, href, hue, cls) {
		var a = h(href ? 'a' : 'span', { class: 'ts-chip' + (cls ? ' ' + cls : ''), href: href, text: text });
		if (hue) { a.style.setProperty('--h', String(Math.round(hue.h))); a.style.setProperty('--s', hue.s + '%'); a.classList.add('is-hued'); }
		return a;
	}
	function labelChips(t, box) {
		t.genres.forEach(function (g) { box.appendChild(chip(g, link('genre', g), T.hueOf(g))); });
		if (t.mood) box.appendChild(chip(T.MOOD_NAME[t.mood] || t.mood, link('c', 'mood', t.mood), { h: MOOD_HUE[t.mood] || 0, s: 60 }, 'is-mood'));
		if (t.scene) box.appendChild(chip(T.SCENE_NAME[t.scene] || t.scene, link('c', 'scene', t.scene), { h: SCENE_HUE[t.scene] || 0, s: 45 }));
		if (t.lang && t.lang !== 'inst') box.appendChild(chip(T.LANG_NAME[t.lang] || t.lang, link('c', 'lang', t.lang)));
		if (t.lang === 'inst') box.appendChild(chip('Instrumental', link('c', 'lang', 'inst')));
		if (t.decade) box.appendChild(chip(t.yearSource === 'upload' ? 'Uploaded ' + t.year : String(t.year), link('c', 'decade', t.decade)));
	}
	function renderNowInfo() {
		var box = $('nowinfo'), id = ctl ? ctl.current() : null, t = id ? lib.tracks[id] : null;
		clear(box);
		if (!t) {
			box.appendChild(h('p', { class: 'ts-muted ts-now-empty', text: L.list(lib).length ? 'Nothing is playing. Press play for a true shuffle of everything, or pick a song, artist, genre or mood.' : 'No music yet. Try the demo, or sign in under Settings.' }));
			return;
		}
		box.appendChild(h('p', { class: 'ts-kicker', text: 'Now playing' }));
		box.appendChild(h('h2', { class: 'ts-now-title', text: trackTitle(t) }));
		if (t.titleAlt && t.titleAlt !== t.title) box.appendChild(h('p', { class: 'ts-now-alt', text: t.titleAlt }));
		box.appendChild(artistLinks(t, 'ts-now-artist'));
		if (t.work) {
			var w = h('p', { class: 'ts-now-work' });
			w.appendChild(h('a', { href: link('work', t.work), text: t.work }));
			if (t.role) w.appendChild(h('span', { class: 'ts-role', text: T.ROLE_NAME[t.role] || t.role }));
			box.appendChild(w);
		}
		var v = versionWords(t);
		if (v) box.appendChild(h('p', { class: 'ts-muted ts-now-ver', text: v }));
		var chips = h('div', { class: 'ts-chips' });
		labelChips(t, chips);
		box.appendChild(chips);
		var row = h('div', { class: 'ts-now-actions' });
		row.appendChild(stars(t));
		row.appendChild(U.iconBtn('radio', 'Radio from this song', { on: { click: function () { startRadio(t); } } }));
		row.appendChild(U.iconBtn('compass', 'Discover new songs like this', { on: { click: function () { location.hash = '#/discover?seed=' + encodeURIComponent(t.id); } } }));
		row.appendChild(U.iconBtn('edit', 'Edit details', { on: { click: function () { openEditor([t.id]); } } }));
		row.appendChild(U.iconBtn('more', 'More', { on: { click: function (e) { trackMenu(t, e.currentTarget, null); } } }));
		box.appendChild(row);
		if (isGuess(t)) box.appendChild(guessBox(t));
	}
	function stars(t) {
		var wrap = h('div', { class: 'ts-stars', role: 'group', aria: { label: 'Your rating' } });
		for (var i = 1; i <= 5; i++) (function (k) {
			var b = h('button', { class: 'ts-star', aria: { label: 'Rate ' + k + ' of 5', pressed: t.rating >= k ? 'true' : 'false' }, title: 'Rate ' + k + ' of 5' }, icon('star'));
			b.addEventListener('click', function () {
				var r = t.rating === k ? 0 : k;
				L.edit(lib, t.id, { rating: r });
				changed([t.id]);
				ToyKit.toast(r ? 'Rated ' + r + ' of 5.' : 'Rating removed.');
			});
			wrap.appendChild(b);
		})(i);
		return wrap;
	}
	function renderQueue() {
		if (!ctl) return;
		var st = ctl.state(), list = $('queue'), up = S.upcoming(st), base = st.index + 1;
		$('queue-context').textContent = '';
		if (context.label && st.items.length) {
			$('queue-context').appendChild(document.createTextNode('Playing from '));
			$('queue-context').appendChild(h('a', { href: context.href || '#/', text: context.label }));
			$('queue-context').appendChild(document.createTextNode(' ' + DOT + ' ' + (queueMode === 'list' ? 'in order' : modeName(plan.mode).toLowerCase())));
		}
		clear(list);
		up.slice(0, 80).forEach(function (id, k) {
			var t = lib.tracks[id], at = base + k;
			if (!t) return;
			var li = h('li', { class: 'ts-q', data: { index: at, id: id } });
			var grip = h('button', { class: 'ts-grip', aria: { label: 'Move ' + trackTitle(t) + ': drag, or arrow keys; Delete removes it' }, data: { index: at } }, icon('grip'));
			li.appendChild(grip);
			var main = h('button', { class: 'ts-q-main', title: 'Play now', on: { click: function () { showDock(); ctl.jump(at); } } });
			main.appendChild(artFor(t, 'ts-q-art'));
			main.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: trackTitle(t) }), h('span', { class: 'ts-q-artist', text: trackArtist(t) })]));
			li.appendChild(main);
			li.appendChild(U.iconBtn('close', 'Remove ' + trackTitle(t) + ' from the queue', { cls: 'ts-q-x', on: { click: function () { ctl.remove(at); } } }));
			list.appendChild(li);
		});
		$('queue-more').textContent = up.length > 80 ? 'and ' + n(up.length - 80) + ' more' : (up.length ? (queueMode === 'true' ? 'The true shuffle draws more as it goes.' : '') : (st.items.length ? 'Nothing after this track.' : 'The queue is empty.'));
		var hl = $('history');
		clear(hl);
		var hist = st.history.slice().reverse();
		hist.slice(0, 50).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t) return;
			var li = h('li', { class: 'ts-q' });
			var main = h('button', { class: 'ts-q-main', title: 'Play it next', on: { click: function () { ctl.playNext([id]); ToyKit.toast(trackTitle(t) + ' plays next.'); } } });
			main.appendChild(artFor(t, 'ts-q-art'));
			main.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: trackTitle(t) }), h('span', { class: 'ts-q-artist', text: trackArtist(t) })]));
			li.appendChild(main);
			hl.appendChild(li);
		});
		$('history-more').textContent = hist.length ? '' : 'Nothing played yet.';
		renderQueueExtras(up);
	}
	function wireQueue() {
		var list = $('queue');
		list.addEventListener('keydown', function (e) {
			var g = e.target.closest && e.target.closest('.ts-grip');
			if (!g) return;
			var at = +g.dataset.index, st = ctl.state(), to = null;
			if (e.key === 'ArrowUp') to = at - 1;
			else if (e.key === 'ArrowDown') to = at + 1;
			else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ctl.remove(at); focusGrip(at); return; }
			else return;
			e.preventDefault();
			if (to <= st.index || to >= st.items.length) return;
			ctl.move(at, to);
			focusGrip(to);
		});
		function focusGrip(at) {
			var g = list.querySelector('.ts-grip[data-index="' + at + '"]') || list.querySelector('.ts-grip[data-index="' + (at - 1) + '"]');
			if (g) g.focus();
		}
		var drag = null;
		list.addEventListener('pointerdown', function (e) {
			var g = e.target.closest && e.target.closest('.ts-grip');
			if (!g) return;
			e.preventDefault();
			drag = { from: +g.dataset.index, to: +g.dataset.index };
			g.parentNode.classList.add('is-drag');
			try { g.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
		});
		list.addEventListener('pointermove', function (e) {
			if (!drag) return;
			var items = list.querySelectorAll('.ts-q'), to = drag.from;
			for (var i = 0; i < items.length; i++) {
				var r = items[i].getBoundingClientRect();
				items[i].classList.remove('drop-before', 'drop-after');
				if (e.clientY >= r.top && e.clientY < r.bottom) to = +items[i].dataset.index;
			}
			drag.to = to;
			var target = list.querySelector('.ts-q[data-index="' + to + '"]');
			if (target && to !== drag.from) target.classList.add(to < drag.from ? 'drop-before' : 'drop-after');
		});
		list.addEventListener('pointerup', function () {
			if (!drag) return;
			var d = drag;
			drag = null;
			if (d.to !== d.from) ctl.move(d.from, d.to); else renderQueue();
		});
		list.addEventListener('pointercancel', function () { drag = null; renderQueue(); });
		var tabs = [$('tab-next'), $('tab-history')];
		function pick(i) {
			tabs.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); t.tabIndex = k === i ? 0 : -1; });
			$('panel-next').hidden = i !== 0;
			$('panel-history').hidden = i !== 1;
		}
		tabs.forEach(function (t, i) {
			t.addEventListener('click', function () { pick(i); });
			t.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var k = 1 - i; pick(k); tabs[k].focus(); } });
		});
		$('btn-save-queue').addEventListener('click', saveQueueAsList);
		$('btn-clear-queue').addEventListener('click', function () { var was = S.upcoming(ctl.state()); if (queueMode === 'true') returnToBag(was); ctl.clearUpcoming(); U.toast('Cleared what was coming next.', { action: 'Undo', onAction: function () {
			if (queueMode === 'true' && bag) { var pl = S.bagPlayed(bag), back = was.filter(function (id) { return pl.indexOf(id) < 0 && bag.order.indexOf(id) >= 0; }), rest = S.bagRemaining(bag).filter(function (id) { return was.indexOf(id) < 0; }), gone = bag.gone; bag = { v: 1, order: pl.concat(back, rest), pos: pl.length + back.length, cycle: bag.cycle, last: bag.last }; if (gone && gone.length) bag.gone = gone.slice(); saveBag(); }
			ctl.playNext(was);
		} }); });
	}
	// The queue on a phone or a narrow window: a sheet over the page.
	function toggleSheet() { if (document.body.classList.contains('sheet-open')) closeSheet(); else openSheet(); }
	function openSheet() {
		document.body.classList.add('sheet-open');
		$('btn-queue').setAttribute('aria-pressed', 'true');
		renderNav();
		var c = $('sheet-close');
		if (c && c.offsetParent) c.focus();
	}
	function closeSheet() {
		if (!document.body.classList.contains('sheet-open')) return;
		document.body.classList.remove('sheet-open');
		$('btn-queue').setAttribute('aria-pressed', 'false');
	}
	// The rows of the current list that show the playing track.
	function markPlaying() {
		var id = ctl ? ctl.current() : null;
		var rows = document.querySelectorAll('.ts-row.is-now');
		for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-now');
		if (!id) return;
		rows = document.querySelectorAll('.ts-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
		for (var j = 0; j < rows.length; j++) rows[j].classList.add('is-now');
	}

	// ---- Track lists ----------------------------------------------------------------------------------
	// A virtual list of tracks with selection (click, Ctrl/Cmd-click, Shift-click),
	// double-click or Enter to play, a menu per row, and a bar for the selection.

	var listSel = null;    // { list, ids: { id: true }, anchor }
	function trackList(view, tracks, opts) {
		opts = opts || {};
		var ctx = opts.context || { label: 'Your library', href: '#/songs', patch: {} };
		var wrap = h('div', { class: 'ts-tracks' + (opts.compact ? ' is-compact' : '') + (opts.noWork ? ' no-work' : '') });
		var head = h('div', { class: 'ts-thead', aria: { hidden: 'true' } }, [
			h('span', { class: 'ts-c-idx', text: '#' }), h('span', { class: 'ts-c-art' }), h('span', { class: 'ts-c-main', text: 'Title' }),
			h('span', { class: 'ts-c-work', text: opts.noWork ? '' : 'From' }), h('span', { class: 'ts-c-genre', text: 'Genre' }), h('span', { class: 'ts-c-len', text: 'Time' }), h('span', { class: 'ts-c-more' })
		]);
		if (!opts.noHead) wrap.appendChild(head);
		var ids = tracks.map(function (t) { return t.id; });
		var sel = { ids: {}, anchor: -1, focus: 0 };
		var vl = U.virtualList({ scroller: $('main'), rowHeight: opts.compact || prefs.density === 'compact' ? 48 : 60, label: opts.label || 'Tracks', render: row });
		liveLists.push(vl);
		wrap.appendChild(vl.node);
		function row(i) {
			var t = tracks[i];
			var r = h('div', { class: 'ts-row' + (sel.ids[t.id] ? ' is-sel' : '') + (t.blocked ? ' is-blocked' : '') + (!L.playable(t) ? ' is-gone' : '') + (ctl && ctl.current() === t.id ? ' is-now' : ''), role: 'listitem', tabindex: i === sel.focus ? '0' : '-1', data: { id: t.id }, aria: { label: trackTitle(t) + ', ' + trackArtist(t) + (sel.ids[t.id] ? ', selected' : '') } });
			var idxc = h('span', { class: 'ts-c-idx' }, [h('span', { class: 'ts-idx-n', text: String(i + 1) }), h('span', { class: 'ts-eq', aria: { hidden: 'true' } }, [h('i'), h('i'), h('i')])]);
			var pb = U.iconBtn('play', 'Play ' + trackTitle(t), { cls: 'ts-row-play', on: { click: function (e) { e.stopPropagation(); play(i); } } });
			pb.tabIndex = -1;
			idxc.appendChild(pb);
			r.appendChild(idxc);
			r.appendChild(h('span', { class: 'ts-c-art' }, artFor(t)));
			var main = h('span', { class: 'ts-c-main' });
			var tl = h('span', { class: 'ts-r-title' }, [h('span', { class: 'ts-r-tt', text: trackTitle(t) })]);
			var v = versionWords(t);
			if (v) tl.appendChild(h('span', { class: 'ts-tag', text: v }));
			if (t.kind === 'set') tl.appendChild(h('span', { class: 'ts-tag', text: 'Set' }));
			if (t.kind === 'clip') tl.appendChild(h('span', { class: 'ts-tag is-warn', text: 'Clip' }));
			if (!L.playable(t)) tl.appendChild(h('span', { class: 'ts-tag is-warn', text: 'Unplayable' }));
			if (t.blocked) tl.appendChild(h('span', { class: 'ts-tag is-warn', text: 'Blocked' }));
			main.appendChild(tl);
			var sub = artistLinks(t, 'ts-r-sub');
			if (opts.extra) { var ex = opts.extra(t); if (ex) sub.appendChild(ex); }
			main.appendChild(sub);
			r.appendChild(main);
			var wk = h('span', { class: 'ts-c-work' });
			if (t.work && !opts.noWork) { wk.appendChild(h('a', { href: link('work', t.work), text: t.work })); if (t.role) wk.appendChild(h('span', { class: 'ts-role', text: t.role })); }
			else if (opts.noWork && t.role) wk.appendChild(h('span', { class: 'ts-role is-big', text: T.ROLE_NAME[t.role] || t.role }));
			r.appendChild(wk);
			var gc = h('span', { class: 'ts-c-genre' });
			if (t.genres[0]) gc.appendChild(chip(t.genres[0], link('genre', t.genres[0]), T.hueOf(t.genres[0]), 'is-small'));
			r.appendChild(gc);
			r.appendChild(h('span', { class: 'ts-c-len', text: t.durationSec ? clock(t.durationSec) : '' }));
			r.appendChild(h('span', { class: 'ts-c-more' }, [likeButton(t), U.iconBtn('more', 'More for ' + trackTitle(t), { on: { click: function (e) { e.stopPropagation(); select(i, e, true); trackMenu(t, e.currentTarget, current()); } } })]));
			r.addEventListener('click', function (e) {
				if (e.target.closest('a')) return;
				if (e.pointerType === 'touch') return;
				select(i, e);
			});
			r.addEventListener('dblclick', function (e) { if (!e.target.closest('a,button')) play(i); });
			r.draggable = true;
			r.addEventListener('dragstart', function (e) { var chosenIds = sel.ids[t.id] ? (current() || [t.id]) : [t.id]; try { e.dataTransfer.setData('application/x-ts-ids', JSON.stringify(chosenIds)); e.dataTransfer.setData('text/plain', chosenIds.length + ' songs'); e.dataTransfer.effectAllowed = 'copy'; } catch (err) { /* old browser */ } document.body.classList.add('is-dragging'); });
			r.addEventListener('dragend', function () { document.body.classList.remove('is-dragging'); });
			r.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!sel.ids[t.id]) select(i, e, true); trackMenu(t, { x: e.clientX, y: e.clientY }, current()); });
			r.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch' && !e.target.closest('a,button')) { e.preventDefault(); play(i); } });
			return r;
		}
		function current() { var out = ids.filter(function (id) { return sel.ids[id]; }); return out.length ? out : null; }
		function play(i) {
			if (opts.onPlay) { opts.onPlay(i); return; }
			playIds(ids, i, ctx);
		}
		function select(i, e, keepIfIn) {
			var id = ids[i];
			if (keepIfIn && sel.ids[id]) return;
			if (e && e.shiftKey && sel.anchor >= 0) {
				var a = Math.min(sel.anchor, i), b = Math.max(sel.anchor, i);
				if (!(e.ctrlKey || e.metaKey)) sel.ids = {};
				for (var k = a; k <= b; k++) sel.ids[ids[k]] = true;
			} else if (e && (e.ctrlKey || e.metaKey)) {
				if (sel.ids[id]) delete sel.ids[id]; else sel.ids[id] = true;
				sel.anchor = i;
			} else {
				sel.ids = {};
				sel.ids[id] = true;
				sel.anchor = i;
			}
			sel.focus = i;
			vl.refresh();
			focusRow(i);
			selBar();
		}
		function focusRow(i) { var r = vl.row(i); if (r) r.focus({ preventScroll: true }); }
		vl.node.addEventListener('keydown', function (e) {
			var r = e.target.closest && e.target.closest('.ts-row');
			if (!r || e.target !== r) return;
			var i = +r.dataset.index, to = null;
			if (e.key === 'ArrowDown') to = Math.min(ids.length - 1, i + 1);
			else if (e.key === 'ArrowUp') to = Math.max(0, i - 1);
			else if (e.key === 'Home') to = 0;
			else if (e.key === 'End') to = ids.length - 1;
			else if (e.key === 'PageDown') to = Math.min(ids.length - 1, i + 10);
			else if (e.key === 'PageUp') to = Math.max(0, i - 10);
			else if (e.key === 'Enter') { e.preventDefault(); play(i); return; }
			else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(i, { ctrlKey: true }); return; }
			else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); if (!sel.ids[ids[i]]) select(i, null, true); var rr = r.getBoundingClientRect(); trackMenu(tracks[i], { x: rr.left + 60, y: rr.bottom }, current()); return; }
			else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopPropagation(); openEditor(current() || [ids[i]]); return; }
			else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ids.forEach(function (x) { sel.ids[x] = true; }); vl.refresh(); focusRow(i); selBar(); return; }
			else if (e.key === 'Escape' && current()) { e.preventDefault(); sel.ids = {}; vl.refresh(); focusRow(i); selBar(); return; }
			else return;
			e.preventDefault();
			if (e.shiftKey) select(to, { shiftKey: true }); else { sel.focus = to; }
			vl.reveal(to);
			vl.refresh();
			focusRow(to);
		});
		function selBar() {
			var chosen = current();
			var bar = view.querySelector('.ts-selbar');
			if (!chosen || chosen.length < 2) { if (bar) bar.parentNode.removeChild(bar); return; }
			if (!bar) { bar = h('div', { class: 'ts-selbar', role: 'region', aria: { label: 'The selected tracks' } }); view.appendChild(bar); }
			clear(bar);
			bar.appendChild(h('span', { class: 'ts-selbar-n', text: plural(chosen.length, 'track') + ' selected' }));
			bar.appendChild(U.iconBtn('play', 'Play', { text: true, on: { click: function () { playIds(chosen, 0, ctx); } } }));
			bar.appendChild(U.iconBtn('playnext', 'Play next', { text: true, on: { click: function () { queueNext(chosen); } } }));
			bar.appendChild(U.iconBtn('queue', 'Add to queue', { text: true, on: { click: function () { queueLater(chosen); } } }));
			bar.appendChild(U.iconBtn('edit', 'Edit', { text: true, on: { click: function () { openEditor(chosen); } } }));
			bar.appendChild(U.iconBtn('plus', 'Add to playlist', { text: true, on: { click: function (e) { addToList(chosen, e.currentTarget); } } }));
			bar.appendChild(U.iconBtn('more', 'More', { on: { click: function (e) { trackMenu(lib.tracks[chosen[0]], e.currentTarget, chosen); } } }));
			bar.appendChild(U.iconBtn('close', 'Clear the selection', { on: { click: function () { sel.ids = {}; vl.refresh(); selBar(); } } }));
		}
		vl.set(tracks.length);
		listSel = { ids: function () { return current(); } };
		view.appendChild(wrap);
		requestAnimationFrame(function () { vl.place(); });
		if (!tracks.length && opts.empty) wrap.appendChild(h('p', { class: 'ts-empty', text: opts.empty }));
		return wrap;
	}

	// The menu for one track or a selection.
	function trackMenu(t, at, many) {
		var ids = many && many.length > 1 ? many : [t.id];
		var one = ids.length === 1 ? lib.tracks[ids[0]] : null;
		var items = [];
		if (one) items.push({ label: 'Play', icon: 'play', onSelect: function () { playIds([one.id], 0, { label: trackTitle(one), href: link('track', one.id) }); } });
		else items.push({ label: 'Play these ' + n(ids.length), icon: 'play', onSelect: function () { playIds(ids, 0, { label: plural(ids.length, 'chosen track'), href: '#/songs' }); } });
		items.push({ label: 'Play next', icon: 'playnext', onSelect: function () { queueNext(ids); } });
		items.push({ label: 'Add to queue', icon: 'queue', onSelect: function () { queueLater(ids); } });
		if (one) items.push({ label: 'Start radio', icon: 'radio', onSelect: function () { startRadio(one); } });
		if (one && one.artistKey) items.push({ label: 'Discover new songs like this', icon: 'compass', onSelect: function () { location.hash = '#/discover?seed=' + encodeURIComponent(one.id); } });
		items.push({ sep: true });
		if (one && one.artistKey) items.push({ label: 'Go to ' + one.artist, icon: 'artist', onSelect: function () { location.hash = link('artist', one.artistKey); } });
		if (one && one.work) items.push({ label: 'Go to ' + one.work, icon: 'works', onSelect: function () { location.hash = link('work', one.work); } });
		if (one && one.channelId) items.push({ label: 'More from this channel', icon: 'external', onSelect: function () { location.hash = link('channel', one.channelId); } });
		if (one) items.push({ label: 'About this track', icon: 'disc', onSelect: function () { location.hash = link('track', one.id); } });
		items.push({ label: one ? 'Edit details' + ELL : 'Edit ' + n(ids.length) + ' tracks' + ELL, icon: 'edit', hint: 'E', onSelect: function () { openEditor(ids); } });
		if (!one) items.push({ label: 'Label them one by one', icon: 'edit', onSelect: function () { startLabelling(ids); } });
		var menuAt = at && at.getBoundingClientRect ? (function () { var rr = at.getBoundingClientRect(); return { x: rr.left, y: rr.bottom }; })() : at;
		items.push({ label: 'Add to playlist' + ELL, icon: 'plus', onSelect: function () { addToList(ids, menuAt); } });
		if (one && !demo && U.YT_ID.test(one.id) && ytTargets().some(function (p) { return !inPlaylist(one.id, p); })) items.push({ label: addLabel() + ' on YouTube' + (ytTargets().length > 1 ? ELL : ''), icon: 'external', onSelect: function () { addToYouTube({ id: one.id, artist: one.artist, title: trackTitle(one), _video: { videoId: one.id } }, menuAt); } });
		var pl = route.parts[0] === 'list' && listById(route.parts[1]);
		if (pl && pl.kind === 'manual') items.push({ label: 'Remove from ' + pl.name, icon: 'close', onSelect: function () { removeFromList(pl, ids); } });
		items.push({ sep: true });
		[5, 4, 3].forEach(function (k) { items.push({ label: 'Rate ' + new Array(k + 1).join(STAR), icon: 'star', checked: one ? one.rating === k : null, onSelect: function () { rateIds(ids, k); } }); });
		items.push({ label: 'Clear rating', icon: 'close', onSelect: function () { rateIds(ids, 0); } });
		var blocked = ids.every(function (id) { return lib.tracks[id].blocked; });
		items.push({ label: blocked ? 'Unblock' : 'Block (never shuffle)', icon: 'block', onSelect: function () { blockIds(ids, !blocked); } });
		if (ids.some(function (id) { return lib.tracks[id].playerError; })) items.push({ label: 'Try playing again', icon: 'rotate', onSelect: function () { changed(L.clearPlayerErrors(lib, ids)); say('Will be tried again.'); } });
		if (one && !demo && U.YT_ID.test(one.id)) items.push({ label: 'Open on YouTube', icon: 'external', onSelect: function () { window.open('https://www.youtube.com/watch?v=' + one.id, '_blank', 'noopener'); } });
		U.openMenu(at, items, { label: one ? 'Actions for ' + trackTitle(one) : 'Actions for ' + n(ids.length) + ' tracks', returnTo: at && at.nodeType ? at : document.activeElement });
	}
	function rateIds(ids, k) {
		L.editMany(lib, ids, { rating: k });
		changed(ids);
		ToyKit.toast(k ? (ids.length === 1 ? 'Rated ' : plural(ids.length, 'track') + ' rated ') + k + ' of 5.' : 'Rating removed.');
	}
	function blockIds(ids, on) {
		L.editMany(lib, ids, { blocked: on });
		changed(ids);
		var msgB = ids.length === 1 ? q(trackTitle(lib.tracks[ids[0]])) + (on ? ' is blocked: no shuffle plays it.' : ' is unblocked.') : plural(ids.length, 'track') + (on ? ' blocked.' : ' unblocked.');
		setStatus(msgB);
		U.toast(msgB, { action: 'Undo', onAction: function () { L.editMany(lib, ids, { blocked: !on }); changed(ids); } });
		if (on && ctl.current() && ids.indexOf(ctl.current()) >= 0) ctl.next();
	}

	// Something that takes songs dragged from a list.
	function dropTarget(node, fn) {
		node.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'application/x-ts-ids') >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; node.classList.add('is-drop'); } });
		node.addEventListener('dragleave', function (e) { if (!node.contains(e.relatedTarget)) node.classList.remove('is-drop'); });
		node.addEventListener('drop', function (e) {
			node.classList.remove('is-drop');
			var raw = e.dataTransfer && e.dataTransfer.getData('application/x-ts-ids');
			if (!raw) return;
			e.preventDefault();
			try { var ids = JSON.parse(raw); if (Array.isArray(ids) && ids.length) fn(ids.filter(function (id) { return lib.tracks[id]; })); } catch (err) { /* not ours */ }
		});
	}

	// ---- Guesses: one tap names the artist -------------------------------------------------------------

	var SPLIT_RULES = { 'dash': 1, 'dash-guess': 1, 'known-artist': 1, 'dash-composer': 1, 'dash-title-artist': 1, 'dash-loose': 1, 'slash-title-artist': 1, 'slash-artist-title': 1, 'slash-guess': 1 };
	function guessPicks(t) {
		if (!t || t.artist || !t.artistGuess) return [];
		var g = t.guess || {}, out = [];
		if (g.artist) out.push([g.artist, g.title]);
		if (g.artist && g.title && SPLIT_RULES[g.rule] && Parse.fold(g.title) !== Parse.fold(g.artist)) out.push([g.title, g.artist]);
		if (!out.length) out.push([t.artistGuess, t.title]);
		return out;
	}
	function guessBox(t) {
		var box = h('div', { class: 'ts-guessbox' });
		box.appendChild(h('p', { class: 'ts-muted', text: 'The artist is not sure. Who is it?' }));
		var row = h('div', { class: 'ts-row-btns' });
		guessPicks(t).forEach(function (p) {
			row.appendChild(h('button', { class: 'kit-btn small', text: 'By ' + p[0] + '?', on: { click: function () { acceptGuess(t.id, p[0], p[1]); } } }));
		});
		row.appendChild(h('button', { class: 'kit-btn small', text: 'Someone else' + ELL, on: { click: function () { openEditor([t.id], 'artist'); } } }));
		box.appendChild(row);
		return box;
	}
	function acceptGuess(id, artist, title) {
		var ck = L.channelKey(lib.tracks[id]);
		L.edit(lib, id, { artist: artist, title: title });
		var amb = L.ambiguousIds(lib).filter(function (x) { return x !== id && L.channelKey(lib.tracks[x]) === ck; });
		var settled = amb.length ? L.deriveIds(lib, amb).filter(function (x) { return lib.tracks[x].artist; }) : [];
		changed([id].concat(settled));
		var planT = L.teachPlan(lib, id, artist);
		if (planT && planT.ids.length) offerTeach(lib.tracks[id], planT);
		else say('Saved: ' + q(title) + ' by ' + artist + '.');
	}
	function ruleWords(rule) {
		if (rule === 'artist-title') return 'as Artist - Title';
		if (rule === 'title-artist') return 'as Title - Artist';
		if (rule === 'channel') return 'with the channel as the artist';
		return 'as all by ' + (rule && rule.artist);
	}
	function offerTeach(t, planT) {
		var d = U.openDialog({ title: 'Read the rest of this channel the same way?' });
		d.body.appendChild(h('p', { text: 'Saved ' + q(trackTitle(t)) + ' by ' + t.artist + '. ' + plural(planT.ids.length, 'other unsure track') + ' on ' + q(t.channel) + ' could be read ' + ruleWords(planT.rule) + '. Tracks with a sure artist and your corrections stay as they are.' }));
		if (planT.conflicts) d.body.appendChild(h('p', { class: 'ts-muted', text: 'Careful: ' + plural(planT.conflicts, 'sure track') + ' on this channel ' + (planT.conflicts === 1 ? 'is' : 'are') + ' written the other way round.' }));
		var row = h('div', { class: 'ts-row-btns' });
		var yes = h('button', { class: 'kit-btn primary', text: planT.ids.length === 1 ? 'Yes, that track' : 'Yes, those ' + plural(planT.ids.length, 'track') });
		yes.addEventListener('click', function () {
			var res = L.teachChannel(lib, planT);
			changed(res.touched, true);
			d.close();
			say(plural(res.ids.length, 'track') + ' from ' + q(t.channel) + ' now read ' + ruleWords(planT.rule) + '.');
		});
		row.appendChild(yes);
		row.appendChild(h('button', { class: 'kit-btn', text: 'No', on: { click: d.close } }));
		d.body.appendChild(row);
		yes.focus();
	}

	// ---- The editor ---------------------------------------------------------------------------------------
	// One track: every field. Several: only the fields the reader sets change.

	var KEEP = '__keep__';
	function openEditor(ids, focusField) {
		ids = ids.filter(function (id) { return lib.tracks[id]; });
		if (!ids.length) return;
		var many = ids.length > 1, t = lib.tracks[ids[0]];
		var d = U.openDialog({ title: many ? 'Edit ' + plural(ids.length, 'track') : 'Edit details', wide: true });
		var form = h('form', { class: 'ts-edit' });
		d.body.appendChild(form);
		if (!many) form.appendChild(h('p', { class: 'ts-muted ts-edit-raw', text: 'On YouTube: ' + q(t.raw.title) + ' ' + DOT + ' ' + (t.channel || 'unknown channel') }));
		else form.appendChild(h('p', { class: 'ts-muted', text: 'Fields left as they are stay as each track has them.' }));
		var grid = h('div', { class: 'ts-edit-grid' });
		form.appendChild(grid);
		var fields = {};
		function lists() {
			var dl = function (idn, values) { var e = h('datalist', { id: idn }); values.forEach(function (v) { e.appendChild(h('option', { value: v })); }); return e; };
			var ix = idx();
			form.appendChild(dl('ts-dl-artists', Object.keys(ix.artists).map(function (k) { return ix.artists[k].name; }).sort(cmp)));
			form.appendChild(dl('ts-dl-works', Object.keys(ix.works).sort(cmp)));
		}
		function text(key, label, value, opts) {
			opts = opts || {};
			var lab = h('label', { class: 'ts-field' + (opts.wide ? ' is-wide' : '') }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: opts.type || 'text', autocomplete: 'off', spellcheck: 'false', list: opts.list, placeholder: many ? 'Leave as it is' : (opts.placeholder || '') });
			inp.value = many ? '' : (value == null ? '' : String(value));
			lab.appendChild(inp);
			grid.appendChild(lab);
			fields[key] = inp;
			return inp;
		}
		function select(key, label, rows, value) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var s = h('select', { class: 'kit-input' });
			if (many) s.appendChild(h('option', { value: KEEP, text: 'Leave as it is' }));
			s.appendChild(h('option', { value: '', text: 'None' }));
			rows.forEach(function (r) { s.appendChild(h('option', { value: r[0], text: r[1] })); });
			s.value = many ? KEEP : (value || '');
			lab.appendChild(s);
			grid.appendChild(lab);
			fields[key] = s;
			return s;
		}
		lists();
		if (!many) text('title', 'Title', t.title, { wide: true });
		if (!many) text('titleAlt', 'Romaji or English title', t.titleAlt, { wide: true, placeholder: 'For search' });
		text('artist', 'Artist', t.artist, { list: 'ts-dl-artists', placeholder: t.artistGuess ? 'Perhaps ' + t.artistGuess : '' });
		text('origArtist', 'Original artist (covers)', t.origArtist, { list: 'ts-dl-artists' });
		text('work', 'From (anime, game, film, musical)', t.work, { list: 'ts-dl-works' });
		select('role', 'Role there', T.ROLES, t.role);
		select('scene', 'Scene', T.SCENES, t.scene);
		select('lang', 'Language', T.LANGS, t.lang);
		select('kind', 'Kind', T.KINDS, t.kind);
		text('year', 'Year', t.yearSource === 'upload' ? '' : t.year, { type: 'number', placeholder: t.yearSource === 'upload' ? 'Uploaded ' + t.year : '' });
		text('version', 'Version', t.version, { placeholder: 'cover, live, piano' + ELL });

		// mood: a row of buttons
		var moodVal = many ? KEEP : (t.mood || '');
		var moodBox = h('div', { class: 'ts-field is-wide' }, [h('span', { text: 'Mood' })]);
		var moodRow = h('div', { class: 'ts-seg', role: 'radiogroup', aria: { label: 'Mood' } });
		var moodOpts = (many ? [[KEEP, 'Leave']] : []).concat([['', 'None']]).concat(T.MOODS.map(function (m) { return [m[0], m[1]]; }));
		moodOpts.forEach(function (m) {
			var b = h('button', { class: 'ts-seg-b', role: 'radio', aria: { checked: moodVal === m[0] ? 'true' : 'false' }, text: m[1], title: m[0] && m[0] !== KEEP ? T.MOODS.filter(function (x) { return x[0] === m[0]; })[0][2] : null });
			if (MOOD_HUE[m[0]] != null) { b.style.setProperty('--h', String(MOOD_HUE[m[0]])); b.classList.add('is-hued'); }
			b.addEventListener('click', function () { moodVal = m[0]; Array.prototype.forEach.call(moodRow.children, function (c) { c.setAttribute('aria-checked', c === b ? 'true' : 'false'); }); });
			moodRow.appendChild(b);
		});
		moodBox.appendChild(moodRow);
		grid.appendChild(moodBox);

		// genres: chosen chips and a picker grouped by family
		var genres = many ? null : t.genres.slice();
		var gBox = h('div', { class: 'ts-field is-wide' }, [h('span', { text: 'Genres (up to three, the most defining first)' })]);
		var chosen = h('div', { class: 'ts-gchosen' });
		var gFind = h('input', { class: 'kit-input', type: 'search', placeholder: 'Find a genre', autocomplete: 'off', aria: { label: 'Find a genre' } });
		var gList = h('div', { class: 'ts-gpick' });
		gBox.appendChild(chosen);
		gBox.appendChild(gFind);
		gBox.appendChild(gList);
		grid.appendChild(gBox);
		function drawChosen() {
			clear(chosen);
			if (genres == null) { chosen.appendChild(h('span', { class: 'ts-muted', text: 'Leave as they are. Pick genres to set them on every selected track.' })); return; }
			if (!genres.length) chosen.appendChild(h('span', { class: 'ts-muted', text: 'None chosen' }));
			genres.forEach(function (g, i) {
				var c = h('button', { class: 'ts-chip is-hued is-removable', title: 'Remove ' + g, aria: { label: 'Remove ' + g } }, [h('span', { text: (i === 0 ? '1. ' : '') + g }), icon('close')]);
				var hu = T.hueOf(g);
				c.style.setProperty('--h', String(hu.h)); c.style.setProperty('--s', hu.s + '%');
				c.addEventListener('click', function () { genres.splice(i, 1); drawChosen(); drawPick(); });
				chosen.appendChild(c);
			});
		}
		function drawPick() {
			clear(gList);
			var f = gFind.value.trim().toLowerCase();
			T.FAMILIES.forEach(function (fam) {
				var names = fam.list.map(function (g) { return g.name; });
				if (fam.key === 'other') knownGenres().forEach(function (g) { if (!T.genre(g) && names.indexOf(g) < 0) names.push(g); });
				names = names.filter(function (g) { return !f || g.toLowerCase().indexOf(f) >= 0 || fam.name.toLowerCase().indexOf(f) >= 0; });
				if (!names.length) return;
				var sec = h('div', { class: 'ts-gfam' }, [h('span', { class: 'ts-gfam-h', text: fam.name })]);
				names.forEach(function (g) {
					var on = genres && genres.indexOf(g) >= 0;
					var b = h('button', { class: 'ts-chip is-hued is-small' + (on ? ' is-on' : ''), text: g, aria: { pressed: on ? 'true' : 'false' }, title: (T.genre(g) || {}).blurb || null });
					var hu = T.hueOf(g);
					b.style.setProperty('--h', String(hu.h)); b.style.setProperty('--s', hu.s + '%');
					b.addEventListener('click', function () {
						if (genres == null) genres = [];
						var at = genres.indexOf(g);
						if (at >= 0) genres.splice(at, 1);
						else { if (genres.length >= 3) genres.pop(); genres.push(g); }
						drawChosen(); drawPick();
					});
					sec.appendChild(b);
				});
				gList.appendChild(sec);
			});
		}
		gFind.addEventListener('input', drawPick);
		gFind.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var first = gList.querySelector('button'); if (first) first.click(); gFind.value = ''; drawPick(); } });
		drawChosen();
		drawPick();

		// advanced: the channel
		var chSel = null;
		if (!many) {
			var det = h('details', { class: 'ts-edit-adv' }, [h('summary', { text: 'The whole channel ' + q(t.channel || 'unknown') })]);
			var ck = L.channelKey(t), chCount = L.list(lib).filter(function (x) { return L.channelKey(x) === ck; }).length;
			det.appendChild(h('p', { class: 'ts-muted', text: plural(chCount, 'track') + ' come from this channel. Teach how its titles read, for this library and later imports.' }));
			chSel = h('select', { class: 'kit-input', aria: { label: 'What the channel\'s titles mean' } });
			[['', 'Leave the other tracks as they are'], ['learn', 'Read the whole channel the way I corrected this track'], ['artist-title', 'Titles there read Artist - Title'], ['title-artist', 'Titles there read Title - Artist'], ['channel', 'The channel name is the artist'], ['fixed', 'Every track there is by the artist above'], ['none', 'Never guess an artist there'], ['forget', 'Forget what I taught about this channel']].forEach(function (c) { chSel.appendChild(h('option', { value: c[0], text: c[1] })); });
			det.appendChild(chSel);
			form.appendChild(det);
		}

		var row = h('div', { class: 'ts-row-btns ts-edit-btns' });
		row.appendChild(h('button', { class: 'kit-btn primary', type: 'submit', text: 'Save' }));
		row.appendChild(h('button', { class: 'kit-btn', text: 'Cancel', on: { click: d.close } }));
		var hasEdits = ids.some(function (id) { return Object.keys(lib.tracks[id].userEdits).length; });
		if (hasEdits) row.appendChild(h('button', { class: 'kit-btn', text: 'Undo my corrections', title: 'Back to the labels and what YouTube says', on: { click: function () {
			var reset = { title: null, artist: null, version: null, year: null, genres: null };
			L.LABEL_FIELDS.forEach(function (k) { reset[k] = null; });
			L.editMany(lib, ids, reset);
			d.close();
			changed(ids);
			say('Back to the labels for ' + plural(ids.length, 'track') + '.');
		} } }));
		form.appendChild(row);

		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var out = {};
			function setText(key, cur) {
				var inp = fields[key];
				if (!inp) return;
				var v = inp.value.trim();
				if (many) { if (v) out[key] = v; return; }
				if (v !== String(cur == null ? '' : cur)) out[key] = v;
			}
			setText('title', t.title);
			setText('titleAlt', t.titleAlt);
			setText('artist', t.artist);
			setText('origArtist', t.origArtist);
			setText('work', t.work);
			setText('version', t.version);
			var yv = fields.year.value.trim();
			if (many) { if (yv) out.year = +yv; }
			else if (yv !== (t.yearSource === 'upload' ? '' : String(t.year || ''))) out.year = yv ? +yv : null;
			['role', 'scene', 'lang', 'kind'].forEach(function (k) {
				var v = fields[k].value;
				if (v === KEEP) return;
				if (many || v !== (t[k] || '')) out[k] = v;
			});
			if (moodVal !== KEEP && (many || moodVal !== (t.mood || ''))) out.mood = moodVal;
			if (genres != null && (many || genres.join('|') !== t.genres.join('|'))) out.genres = genres.slice();
			// an emptied title or artist means "back to what was read"
			if (out.title === '') out.title = null;
			if (out.artist === '') out.artist = null;
			var touched = ids.slice(), meta = false, msg = [];
			if (Object.keys(out).length) { L.editMany(lib, ids, out); msg.push('Saved' + (many ? ' on ' + plural(ids.length, 'track') : '') + '.'); }
			if (chSel && chSel.value) {
				var ch = chSel.value, artist = fields.artist.value.trim();
				if ((ch === 'fixed' || ch === 'learn') && !artist) { fields.artist.focus(); ToyKit.toast('Type the artist first.'); return; }
				var rule = ch === 'forget' ? null : ch === 'fixed' ? { artist: artist } : ch === 'learn' ? L.learnRule(lib, t.id, artist) : ch;
				var chIds = L.setChannelRule(lib, L.channelKey(t), rule);
				touched = touched.concat(chIds);
				meta = true;
				msg.push('The channel: ' + plural(chIds.length, 'track') + ' read again.');
			}
			d.close();
			if (out.artist) { var amb = L.resolveArtists(lib); touched = touched.concat(amb); }
			changed(touched, meta);
			say(msg.join(' ') || 'Nothing changed.');
		});
		var first = focusField && fields[focusField] ? fields[focusField] : form.querySelector('input,select');
		if (first) first.focus();
	}

	// ---- View helpers --------------------------------------------------------------------------------------

	function secs(tracks) { var s = 0; tracks.forEach(function (t) { s += t.durationSec || 0; }); return s; }
	function playable(tracks) { return tracks.filter(function (t) { return L.playable(t) && !t.blocked; }); }
	function headerBlock(view, o) {
		var head = h('header', { class: 'ts-hero' + (o.round ? ' is-round' : '') });
		var hue = o.hue || { h: 210, s: 40 };
		head.style.setProperty('--h', String(Math.round(hue.h)));
		head.style.setProperty('--s', hue.s + '%');
		if (o.art !== false) head.appendChild(o.artNode || U.swatch(hue.h, o.title, 'ts-hero-art', hue.s));
		var txt = h('div', { class: 'ts-hero-text' });
		if (o.kicker) txt.appendChild(h('p', { class: 'ts-kicker', text: o.kicker }));
		txt.appendChild(h('h1', { class: 'ts-hero-title', text: o.title }));
		if (o.alt) txt.appendChild(h('p', { class: 'ts-hero-alt', text: o.alt }));
		if (o.blurb) txt.appendChild(h('p', { class: 'ts-hero-blurb', text: o.blurb }));
		if (o.meta) txt.appendChild(h('p', { class: 'ts-hero-meta', text: o.meta }));
		if (o.chips) { var c = h('div', { class: 'ts-chips' }); o.chips.forEach(function (x) { c.appendChild(x); }); txt.appendChild(c); }
		head.appendChild(txt);
		view.appendChild(head);
		if (o.actions) {
			var row = h('div', { class: 'ts-actions' });
			o.actions.forEach(function (a) { if (a) row.appendChild(a); });
			view.appendChild(row);
			stickyHeader(view, o.title, row);
		}
		return head;
	}
	function bigPlay(label, fn) { var b = h('button', { class: 'ts-bigplay', aria: { label: label }, title: label, on: { click: fn } }, icon('play')); return b; }
	function actionBtn(iconName, label, fn, primary) { return U.iconBtn(iconName, label, { text: true, cls: 'ts-act' + (primary ? ' is-primary' : ''), on: { click: fn } }); }
	function metaLine(tracks) { return plural(tracks.length, 'song') + (secs(tracks) ? ' ' + DOT + ' ' + longTime(secs(tracks)) : ''); }
	function sortSelect(value, onChange, opts) {
		var s = h('select', { class: 'kit-input ts-sort', aria: { label: 'Sort by' } });
		(opts || SORT_OPTS).forEach(function (o) { s.appendChild(h('option', { value: o[0], text: o[1] })); });
		s.value = value;
		s.addEventListener('change', function () { onChange(s.value); });
		return s;
	}
	var SORT_OPTS = [['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['plays', 'Most played'], ['rating', 'Rating'], ['year', 'Year'], ['length', 'Length'], ['work', 'Anime / work']];
	var SORTS = {
		title: function (a, b) { return cmp(trackTitle(a), trackTitle(b)); },
		artist: function (a, b) { return cmp(trackArtist(a), trackArtist(b)) || cmp(trackTitle(a), trackTitle(b)); },
		plays: function (a, b) { return b.plays - a.plays || SORTS.title(a, b); },
		rating: function (a, b) { return (b.rating || 0) - (a.rating || 0) || SORTS.plays(a, b); },
		length: function (a, b) { return (b.durationSec || 0) - (a.durationSec || 0); },
		added: function (a, b) { return (L.lastAdded(b) || 0) - (L.lastAdded(a) || 0); },
		year: function (a, b) { return (a.year || 9999) - (b.year || 9999) || SORTS.title(a, b); },
		work: function (a, b) { return cmp(a.work || '\uFFFF', b.work || '\uFFFF') || roleRank(a) - roleRank(b) || SORTS.title(a, b); }
	};
	var ROLE_ORDER = ['OP', 'ED', 'insert', 'theme', 'image', 'OST', ''];
	function roleRank(t) { var i = ROLE_ORDER.indexOf(t.role || ''); return i < 0 ? 9 : i; }
	function sorted(tracks, key) { return tracks.slice().sort(SORTS[key] || SORTS.added); }
	function sectionHead(view, title, more) {
		var hd = h('div', { class: 'ts-sec-head' }, [h('h2', { text: title })]);
		if (more) hd.appendChild(h('a', { class: 'ts-sec-more', href: more.href, text: more.text || 'Show all' }));
		view.appendChild(hd);
	}
	function shelf(view, cards) { var row = h('div', { class: 'ts-shelf' }); cards.forEach(function (c) { row.appendChild(c); }); view.appendChild(row); return row; }
	function grid(view, cards, cls) { var g = h('div', { class: 'ts-grid' + (cls ? ' ' + cls : '') }); cards.forEach(function (c) { g.appendChild(c); }); view.appendChild(g); return g; }
	// A card: art, a title, a line; a play button over the art.
	function card(o) {
		var c = h('div', { class: 'ts-card' + (o.round ? ' is-round' : '') + (o.cls ? ' ' + o.cls : '') });
		var a = h('a', { class: 'ts-card-a', href: o.href });
		a.appendChild(o.art);
		a.appendChild(h('span', { class: 'ts-card-title', text: o.title }));
		if (o.sub) a.appendChild(h('span', { class: 'ts-card-sub', text: o.sub }));
		c.appendChild(a);
		if (o.play) c.appendChild(bigPlay(o.playLabel || 'Play ' + o.title, function (e) { e.preventDefault(); o.play(); }));
		return c;
	}
	function tile(o) {
		var a = h('a', { class: 'ts-tile' + (o.cls ? ' ' + o.cls : ''), href: o.href });
		a.style.setProperty('--h', String(Math.round(o.hue.h)));
		a.style.setProperty('--s', (o.hue.s == null ? 55 : o.hue.s) + '%');
		a.appendChild(h('span', { class: 'ts-tile-title', text: o.title }));
		if (o.sub) a.appendChild(h('span', { class: 'ts-tile-sub', text: o.sub }));
		if (o.cover) { var art = artFor(o.cover, 'ts-tile-art'); a.appendChild(art); }
		var wrap = h('div', { class: 'ts-tile-wrap' }, a);
		if (o.play) wrap.appendChild(bigPlay(o.playLabel || 'Shuffle ' + o.title, function (e) { e.preventDefault(); o.play(); }));
		return wrap;
	}
	function artistCard(a) {
		var hue = familyHue(a.family);
		var art = a.cover && prefs.art && !demo ? U.art(a.cover.id, hue.h, a.name, 'is-round', true, hue.s) : U.swatch(hue.h, a.name, 'is-round', hue.s);
		return card({ round: true, href: link('artist', a.key), art: art, title: a.name, sub: plural(a.tracks.length, 'song'), play: function () { shuffleThese({ artists: [a.key] }, { label: a.name, href: link('artist', a.key) }); }, playLabel: 'Shuffle ' + a.name });
	}
	function workCard(w) {
		var hue = { h: SCENE_HUE[w.scene] || 210, s: 45 };
		return card({ href: link('work', w.key), art: w.cover ? artFor(w.cover) : U.swatch(hue.h, w.key), title: w.key, sub: (T.SCENE_NAME[w.scene] || 'Work') + ' ' + DOT + ' ' + plural(w.tracks.length, 'song') + roleSummary(w.tracks), play: function () { var ts = sorted(w.tracks, 'work'); playIds(ts.map(function (t) { return t.id; }), 0, { label: w.key, href: link('work', w.key), patch: { works: [w.key] } }); }, playLabel: 'Play ' + w.key });
	}
	function roleSummary(tracks) {
		var c = {};
		tracks.forEach(function (t) { if (t.role === 'OP' || t.role === 'ED') c[t.role] = (c[t.role] || 0) + 1; });
		var parts = [];
		if (c.OP) parts.push(c.OP + ' OP');
		if (c.ED) parts.push(c.ED + ' ED');
		return parts.length ? ' ' + DOT + ' ' + parts.join(', ') : '';
	}
	function trackCard(t, ids, i, ctx) {
		return card({ href: link('track', t.id), art: artFor(t), title: trackTitle(t), sub: trackArtist(t), play: function () { playIds(ids, i, ctx); }, playLabel: 'Play ' + trackTitle(t) });
	}
	function noMusic(view) {
		if (focus && listById(focus) && L.list(lib).length) { view.appendChild(h('p', { class: 'ts-empty' }, ['Nothing in ' + q(listById(focus).name) + ' yet. ', h('button', { class: 'ts-link-btn', text: 'Show everything', on: { click: function () { setFocus(null); } } })])); return; }
		var box = h('section', { class: 'ts-welcome' });
		box.appendChild(h('h1', { text: 'Your playlists, as a music app' }));
		box.appendChild(h('p', { text: 'True Shuffle reads your own YouTube playlists and Liked videos (read-only, after a Google sign-in), works out artist and title for every video, and lets you browse them by artist, genre, mood and the anime or game they come from, and shuffle them properly. Your library stays in this browser.' }));
		var row = h('div', { class: 'ts-row-btns' });
		row.appendChild(h('a', { class: 'kit-btn primary', href: '?demo=1', text: 'Try the demo' }));
		row.appendChild(h('a', { class: 'kit-btn', href: '#/settings', text: 'Sign in or import a file' }));
		box.appendChild(row);
		box.appendChild(h('p', { class: 'ts-muted', text: 'The demo runs on an invented library with a player that only advances a clock. Nothing is contacted until you press Sign in or Play.' }));
		view.appendChild(box);
	}
	function greeting() {
		if (thumb) return 'Good evening';
		var hr = new Date().getHours();
		return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
	}

	// ---- Home ------------------------------------------------------------------------------------------

	function viewHome(view) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var music = playable(ix.music);
		var hero = h('section', { class: 'ts-home-hero' });
		hero.appendChild(h('h1', { class: 'ts-greet', text: greeting() }));
		hero.appendChild(h('p', { class: 'ts-muted', text: plural(music.length, 'song') + ' ' + DOT + ' ' + plural(Object.keys(ix.artists).length, 'artist') + ' ' + DOT + ' ' + longTime(secs(music)) + ' of music' }));
		var quick = h('div', { class: 'ts-quick' });
		function quickBtn(iconName, title, sub, fn, hue) {
			var b = h('button', { class: 'ts-quickb', on: { click: fn } });
			if (hue) { b.style.setProperty('--h', String(hue)); }
			b.appendChild(h('span', { class: 'ts-quick-ic' }, icon(iconName)));
			b.appendChild(h('span', { class: 'ts-quick-t' }, [h('b', { text: title }), h('span', { text: sub })]));
			return b;
		}
		quick.appendChild(quickBtn(modeIcon(plan.mode === 'original' ? 'true' : plan.mode), 'Shuffle everything', modeName(plan.mode === 'original' ? 'true' : plan.mode) + ' ' + DOT + ' ' + (modeInfo(plan.mode === 'original' ? 'true' : plan.mode).blurb), function () { shuffleThese({}, { label: 'Everything', href: '#/songs' }); }, 265));
		var daily = dailyMix(music);
		quick.appendChild(quickBtn('newest', 'Today\'s mix', plural(daily.length, 'song') + ', new every day', function () { playIds(daily, 0, { label: 'Today\'s mix', href: '#/' }); }, 200));
		quick.appendChild(quickBtn('history', 'Rediscover', 'Long unplayed, never heard', function () { shuffleThese({}, { label: 'Rediscover', href: '#/' }, 'neglected'); }, 30));
		var st = ctl && ctl.state();
		if (st && st.items.length && ctl.current()) {
			var t = lib.tracks[ctl.current()];
			quick.appendChild(quickBtn('play', 'Continue', t ? trackTitle(t) : 'Your queue', function () { togglePlay(); }, 150));
		}
		hero.appendChild(quick);
		var orderRow = h('div', { class: 'ts-orderrow' }, [h('span', { class: 'ts-muted', text: 'Shuffles use' })]);
		var hp = h('button', { class: 'ts-modepill', aria: { haspopup: 'menu' } });
		fillModePill(hp);
		hp.addEventListener('click', function () { modeMenu(hp, function (key) { plan.mode = key; if (!thumb) store.set('plan', plan); renderView(true); renderModePill(); say('Shuffles now use ' + modeName(key) + '.'); }, { heading: 'How shuffles pick songs' }); });
		orderRow.appendChild(hp);
		hero.appendChild(orderRow);
		view.appendChild(hero);
		var rp = recentlyPlayed(18);
		if (rp.length) { sectionHead(view, 'Recently played', { href: '#/history', text: 'History' }); shelf(view, rp.map(function (id, i) { return trackCard(lib.tracks[id], rp, i, { label: 'Recently played', href: '#/history' }); })); }
		if (!focus) {
			var sgs = suggestions().slice(0, 10);
			if (sgs.length) {
				sectionHead(view, 'Work with part of your library', { href: '#/lists', text: 'Playlists' });
				var fr = h('div', { class: 'ts-chips ts-chipbar' });
				sgs.forEach(function (s) { fr.appendChild(h('button', { class: 'ts-chip is-hued', style: { '--h': String(s.hue.h), '--s': s.hue.s + '%' }, on: { click: function () { var li = { id: newId(), name: s.name, kind: 'smart', patch: s.patch, created: new Date().toISOString(), auto: true }; lists.push(li); saveLists(); setFocus(li.id); } } }, [h('span', { text: s.name }), h('span', { class: 'ts-count', text: n(s.n) })])); });
				view.appendChild(fr);
			}
		}

		var moods = T.MOODS.filter(function (m) { return ix.moods[m[0]]; });
		if (moods.length) {
			sectionHead(view, 'Moods', { href: '#/browse', text: 'Browse' });
			grid(view, moods.map(function (m) {
				var e = ix.moods[m[0]];
				return tile({ href: link('c', 'mood', m[0]), title: m[1], sub: m[2] + ' ' + n(e.tracks.length), hue: { h: MOOD_HUE[m[0]], s: 62 }, cls: 'is-mood', play: function () { shuffleThese({ moods: [m[0]] }, { label: m[1], href: link('c', 'mood', m[0]) }); } });
			}), 'is-tiles');
		}
		var fams = T.FAMILIES.filter(function (f) { return ix.families[f.key]; }).sort(function (a, b) { return ix.families[b.key].tracks.length - ix.families[a.key].tracks.length; });
		if (fams.length) {
			sectionHead(view, 'Your sound', { href: '#/genres', text: 'All genres' });
			shelf(view, fams.map(function (f) {
				var e = ix.families[f.key];
				return tile({ href: link('family', f.key), title: f.name, sub: plural(e.tracks.length, 'song'), hue: familyHue(f.key), cover: coverOf(e.tracks), cls: 'is-family', play: function () { shuffleThese({ families: [f.key] }, { label: f.name, href: link('family', f.key) }); } });
			}));
		}
		var scenes = T.SCENES.filter(function (s) { return ix.scenes[s[0]]; }).sort(function (a, b) { return ix.scenes[b[0]].tracks.length - ix.scenes[a[0]].tracks.length; });
		if (scenes.length) {
			sectionHead(view, 'Scenes');
			shelf(view, scenes.map(function (s) {
				var e = ix.scenes[s[0]];
				return tile({ href: link('c', 'scene', s[0]), title: s[1], sub: plural(e.tracks.length, 'song'), hue: { h: SCENE_HUE[s[0]], s: 50 }, cover: coverOf(e.tracks), play: function () { shuffleThese({ scenes: [s[0]] }, { label: s[1], href: link('c', 'scene', s[0]) }); } });
			}));
		}
		var artists = Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).sort(function (a, b) { return (b.plays * 3 + b.tracks.length) - (a.plays * 3 + a.tracks.length) || cmp(a.name, b.name); }).slice(0, 18);
		if (artists.length) { sectionHead(view, 'Your artists', { href: '#/artists' }); shelf(view, artists.map(artistCard)); }
		var works = Object.keys(ix.works).map(function (k) { return ix.works[k]; }).sort(function (a, b) { return b.tracks.length - a.tracks.length || cmp(a.key, b.key); }).slice(0, 18);
		if (works.length) { sectionHead(view, 'From your anime, games and stage', { href: '#/works' }); shelf(view, works.map(workCard)); }
		var nowD = new Date(now()), thisYear = nowD.getUTCFullYear(), mm = nowD.getUTCMonth();
		var back = music.filter(function (t) { var f = S.firstAdded(t); if (!f) return false; var d = new Date(f); var diff = (mm - d.getUTCMonth() + 12) % 12; return d.getUTCFullYear() < thisYear && (diff <= 0 || diff >= 11); });
		if (back.length >= 4) {
			var bk = S.trueShuffle(back, S.rng('back-' + ToyKit.daily())).slice(0, 18).map(function (id) { return lib.tracks[id]; }), bIds = bk.map(function (t) { return t.id; });
			sectionHead(view, 'Around this time in earlier years', { href: link('c', 'added', new Date(S.firstAdded(bk[0])).toISOString().slice(0, 7)), text: 'That month' });
			shelf(view, bk.map(function (t, i) { var c = trackCard(t, bIds, i, { label: 'Around this time, earlier years', href: '#/' }); var sub = c.querySelector('.ts-card-sub'); if (sub) sub.textContent = trackArtist(t) + ' ' + DOT + ' added ' + addedName(new Date(S.firstAdded(t)).toISOString().slice(0, 7)); return c; }));
		}
		var recent = sorted(music, 'added').slice(0, 18), rIds = recent.map(function (t) { return t.id; });
		if (recent.length) { sectionHead(view, 'Recently added', { href: '#/songs?sort=added' }); shelf(view, recent.map(function (t, i) { return trackCard(t, rIds, i, { label: 'Recently added', href: '#/songs?sort=added' }); })); }
		var neg = S.neglected(music, thumb ? S.rng('home') : S.rng(ToyKit.daily()), now()).slice(0, 18).map(function (id) { return lib.tracks[id]; });
		var nIds = neg.map(function (t) { return t.id; });
		if (neg.length) { sectionHead(view, 'Waiting for you'); shelf(view, neg.map(function (t, i) { return trackCard(t, nIds, i, { label: 'Waiting for you', href: '#/' }); })); }
		if (ix.needs.unsure && !demo) {
			var nb = h('a', { class: 'ts-needs', href: '#/fix' }, [icon('fix'), h('span', { text: plural(ix.needs.unsure, 'track') + ' still have no sure artist. Name them in one tap each.' })]);
			view.appendChild(nb);
		}
		view.appendChild(h('p', { class: 'ts-legal', text: 'This page uses YouTube API Services. ' }, [h('a', { href: 'https://www.youtube.com/t/terms', rel: 'noopener', text: 'YouTube Terms of Service' }), ' ' + DOT + ' ', h('a', { href: 'https://policies.google.com/privacy', rel: 'noopener', text: 'Google Privacy Policy' })]));
	}
	// Today's mix: thirty songs, seeded by the date, spread across artists,
	// weighted toward what is rated and played, and mostly one or two moods.
	function dailyMix(music) {
		var r = S.rng('daily-' + ToyKit.daily());
		var moods = T.MOODS.map(function (m) { return m[0]; }).filter(function (m) { return music.some(function (t) { return t.mood === m; }); });
		var pick = moods.length ? [moods[r.int(moods.length)], moods[r.int(moods.length)]] : [];
		var pool = music.filter(function (t) { return !pick.length || pick.indexOf(t.mood) >= 0 || r() < 0.15; });
		var ordered = S.favourites(pool, r).slice(0, 60).map(function (id) { return lib.tracks[id]; });
		return S.spreadShuffle(ordered, r, {}).slice(0, 30);
	}

	// ---- Search and browse --------------------------------------------------------------------------------

	function viewSearch(view, parts, query) {
		var qtext = query.get('q') || '';
		var inp = $('search');
		if (document.activeElement !== inp) inp.value = qtext;
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		if (!qtext.trim()) { browseTiles(view, 'Browse all'); return; }
		var f = Parse.fold(qtext);
		var songs = L.search(lib, qtext);
		var artists = Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).filter(function (a) { return Parse.fold(a.name + ' ' + a.native).indexOf(f) >= 0; }).sort(function (a, b) { return b.tracks.length - a.tracks.length; });
		var works = Object.keys(ix.works).map(function (k) { return ix.works[k]; }).filter(function (w) { return Parse.fold(w.key).indexOf(f) >= 0; }).sort(function (a, b) { return b.tracks.length - a.tracks.length; });
		var genres = Object.keys(ix.genres).filter(function (g) { return Parse.fold(g).indexOf(f) >= 0; });
		var moods = T.MOODS.filter(function (m) { return ix.moods[m[0]] && Parse.fold(m[1]).indexOf(f) >= 0; });
		var scenes = T.SCENES.filter(function (s) { return ix.scenes[s[0]] && Parse.fold(s[1]).indexOf(f) >= 0; });
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Results for ' + q(qtext) }));
		if (!songs.length && !artists.length && !works.length && !genres.length && !moods.length && !scenes.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'Nothing found. Search knows titles in any script, romaji, artists, anime and games, genres and moods.' })); return; }
		var top = h('div', { class: 'ts-search-top' });
		if (artists[0] && (Parse.fold(artists[0].name) === f || !songs.length)) top.appendChild(artistCard(artists[0]));
		else if (works[0] && Parse.fold(works[0].key) === f) top.appendChild(workCard(works[0]));
		var chipsRow = h('div', { class: 'ts-chips' });
		genres.forEach(function (g) { chipsRow.appendChild(chip(g, link('genre', g), T.hueOf(g))); });
		moods.forEach(function (m) { chipsRow.appendChild(chip(m[1], link('c', 'mood', m[0]), { h: MOOD_HUE[m[0]], s: 60 })); });
		scenes.forEach(function (s) { chipsRow.appendChild(chip(s[1], link('c', 'scene', s[0]), { h: SCENE_HUE[s[0]], s: 45 })); });
		if (chipsRow.firstChild) top.appendChild(chipsRow);
		if (top.firstChild) view.appendChild(top);
		if (artists.length) { sectionHead(view, 'Artists'); shelf(view, artists.slice(0, 12).map(artistCard)); }
		if (works.length) { sectionHead(view, 'Anime, games & stage'); shelf(view, works.slice(0, 12).map(workCard)); }
		if (songs.length) {
			sectionHead(view, 'Songs (' + n(songs.length) + ')');
			view.appendChild(h('div', { class: 'ts-row-btns' }, [actionBtn('shuffle', 'Shuffle these', function () { shuffleThese({ text: qtext }, { label: 'Search: ' + qtext, href: '#/search?q=' + encodeURIComponent(qtext) }); })].concat(scopeButtons({ text: qtext }, capital(qtext)))));
			trackList(view, songs, { context: { label: 'Search: ' + qtext, href: '#/search?q=' + encodeURIComponent(qtext), patch: {} } });
		}
	}
	function browseTiles(view, title) {
		var ix = idx();
		if (title) view.appendChild(h('h1', { class: 'ts-h1', text: title }));
		sectionHead(view, 'Genre families');
		grid(view, T.FAMILIES.filter(function (f) { return ix.families[f.key]; }).map(function (f) {
			return tile({ href: link('family', f.key), title: f.name, sub: plural(ix.families[f.key].tracks.length, 'song'), hue: familyHue(f.key), cover: coverOf(ix.families[f.key].tracks), cls: 'is-family' });
		}), 'is-tiles');
		var moods = T.MOODS.filter(function (m) { return ix.moods[m[0]]; });
		if (moods.length) { sectionHead(view, 'Moods'); grid(view, moods.map(function (m) { return tile({ href: link('c', 'mood', m[0]), title: m[1], sub: m[2], hue: { h: MOOD_HUE[m[0]], s: 62 }, cls: 'is-mood' }); }), 'is-tiles'); }
		var scenes = T.SCENES.filter(function (s) { return ix.scenes[s[0]]; });
		if (scenes.length) { sectionHead(view, 'Scenes'); grid(view, scenes.map(function (s) { return tile({ href: link('c', 'scene', s[0]), title: s[1], sub: plural(ix.scenes[s[0]].tracks.length, 'song'), hue: { h: SCENE_HUE[s[0]], s: 50 } }); }), 'is-tiles'); }
		var langs = T.LANGS.filter(function (l) { return ix.langs[l[0]]; });
		if (langs.length) { sectionHead(view, 'Languages'); grid(view, langs.map(function (l) { return tile({ href: link('c', 'lang', l[0]), title: l[1], sub: plural(ix.langs[l[0]].tracks.length, 'song'), hue: { h: LANG_HUE[l[0]] || 200, s: 35 } }); }), 'is-tiles is-small'); }
		var ys = Object.keys(ix.addedY).sort();
		if (ys.length) {
			sectionHead(view, 'When you added them');
			grid(view, ys.slice().reverse().map(function (y) { return tile({ href: link('c', 'added', y), title: y, sub: plural(ix.addedY[y].tracks.length, 'song') + ' added', hue: addedHue(y), cover: coverOf(ix.addedY[y].tracks) }); }), 'is-tiles is-small');
			var ms = Object.keys(ix.addedM).sort();
			if (ms.length > 1) timeline(view, ms, ix);
		}
		var decs = Object.keys(ix.decades).sort();
		if (decs.length) { sectionHead(view, 'Decades'); grid(view, decs.map(function (dk) { return tile({ href: link('c', 'decade', dk), title: dk, sub: plural(ix.decades[dk].tracks.length, 'song'), hue: { h: (parseInt(dk, 10) - 1950) * 4 + 180, s: 30 } }); }), 'is-tiles is-small'); }
	}
	// Songs added per month, a single-series column chart: one hue, the count on hover and in
	// each column's name, every column a link to that month.
	function timeline(view, months, ix) {
		var first = months[0], last = months[months.length - 1], all = [], y = +first.slice(0, 4), mo = +first.slice(5);
		while (true) { var k = y + '-' + (mo < 10 ? '0' : '') + mo; all.push(k); if (k >= last) break; mo++; if (mo > 12) { mo = 1; y++; } }
		var max = 1;
		all.forEach(function (k) { if (ix.addedM[k]) max = Math.max(max, ix.addedM[k].tracks.length); });
		var fig = h('figure', { class: 'ts-timeline' });
		fig.appendChild(h('figcaption', { class: 'ts-muted', text: 'Songs added per month, ' + addedName(first) + ' to ' + addedName(last) + '. Each column opens that month.' }));
		var row = h('div', { class: 'ts-tl-cols', role: 'list' });
		all.forEach(function (k) {
			var c = ix.addedM[k] ? ix.addedM[k].tracks.length : 0;
			var col = h(c ? 'a' : 'span', { class: 'ts-tl-col' + (k.slice(5) === '01' ? ' is-year' : ''), href: c ? link('c', 'added', k) : null, role: 'listitem', title: addedName(k) + ': ' + plural(c, 'song'), aria: { label: addedName(k) + ': ' + plural(c, 'song') } });
			col.appendChild(h('i', { style: { height: (c ? Math.max(3, 100 * c / max) : 0) + '%' } }));
			if (k.slice(5) === '01' || k === first) col.appendChild(h('b', { text: k.slice(0, 4) }));
			row.appendChild(col);
		});
		fig.appendChild(row);
		view.appendChild(fig);
	}
	function viewBrowse(view, parts, query) {
		if (!idx().all.length) { noMusic(view); return; }
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Moods & scenes' }));
		var picked = browseMixer(view, query || route.query);
		if (!picked) moodMatrix(view);
		browseTiles(view, null);
	}

	// ---- Songs ----------------------------------------------------------------------------------------------

	function viewSongs(view, parts, query) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var sort = query.get('sort') || ToyKit.load('songsSort', 'added'), show = query.get('show') || 'music', filt = query.get('f') || '';
		var base = show === 'all' ? ix.all : show === 'clips' ? ix.all.filter(function (t) { return t.kind === 'clip'; }) : show === 'unplayed' ? ix.music.filter(function (t) { return !t.plays; }) : show === 'rated' ? ix.all.filter(function (t) { return t.rating > 0; }) : ix.music;
		var list = filt ? L.search(lib, filt, base) : sorted(base, sort);
		headerBlock(view, { title: 'Songs', kicker: 'Library', meta: metaLine(list), hue: { h: 265, s: 45 }, art: false, actions: [
			actionBtn('play', 'Play', function () { playIds(list.map(function (t) { return t.id; }), 0, { label: 'Songs', href: '#/songs' }); }, true),
			shuffleSplit({}, { label: 'All songs', href: '#/songs' })
		] });
		var bar = h('div', { class: 'ts-filterbar' });
		var fi = h('input', { class: 'kit-input ts-filter', type: 'search', placeholder: 'Filter these songs', value: filt, aria: { label: 'Filter these songs' } });
		fi.addEventListener('input', later(function () { setQuery({ f: fi.value || null }); }, 250));
		bar.appendChild(fi);
		var showSel = h('select', { class: 'kit-input', aria: { label: 'Show' } });
		[['music', 'Music'], ['all', 'Everything'], ['unplayed', 'Never played'], ['rated', 'Rated'], ['clips', 'Clips (not music)']].forEach(function (o) { showSel.appendChild(h('option', { value: o[0], text: o[1] })); });
		showSel.value = show;
		showSel.addEventListener('change', function () { setQuery({ show: showSel.value === 'music' ? null : showSel.value }); });
		bar.appendChild(showSel);
		bar.appendChild(sortSelect(sort, function (v) { ToyKit.store('songsSort', v); setQuery({ sort: v }); }));
		view.appendChild(bar);
		trackList(view, list, { context: { label: 'Songs', href: '#/songs', patch: {} }, empty: 'No songs match.' });
		if (filt) setTimeout(function () { var x = view.querySelector('.ts-filter'); if (x && document.activeElement === document.body) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 0);
	}
	// Change the query of the current route without a new history entry.
	function setQuery(changes) {
		var qs = new URLSearchParams(route.query.toString());
		for (var k in changes) { if (changes[k] == null || changes[k] === '') qs.delete(k); else qs.set(k, changes[k]); }
		var s = qs.toString(), hash = '#' + route.path + (s ? '?' + s : '');
		var focused = document.activeElement, cls = focused && focused.className, val = focused && focused.value, pos = focused && focused.selectionStart;
		history.replaceState(null, '', hash);
		route = U.parseHash(hash);
		renderView(true);
		if (cls && typeof cls === 'string' && focused.tagName === 'INPUT') {
			var again = $('view').querySelector('input.' + cls.split(' ').join('.'));
			if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* search inputs */ } }
		}
	}

	// ---- Artists ------------------------------------------------------------------------------------------

	function viewArtists(view, parts, query) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var fam = query.get('family') || '', sort = query.get('sort') || 'songs', filt = query.get('f') || '';
		var all = Object.keys(ix.artists).map(function (k) { return ix.artists[k]; });
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Artists' }));
		var bar = h('div', { class: 'ts-filterbar' });
		var fi = h('input', { class: 'kit-input ts-filter', type: 'search', placeholder: 'Find an artist', value: filt, aria: { label: 'Find an artist' } });
		fi.addEventListener('input', later(function () { setQuery({ f: fi.value || null }); }, 250));
		bar.appendChild(fi);
		bar.appendChild(sortSelect(sort, function (v) { setQuery({ sort: v === 'songs' ? null : v }); }, [['songs', 'Most songs'], ['plays', 'Most played'], ['name', 'Name']]));
		view.appendChild(bar);
		var chips = h('div', { class: 'ts-chips ts-chipbar' });
		chips.appendChild(h('a', { class: 'ts-chip' + (fam ? '' : ' is-on'), href: '#/artists', text: 'All ' + n(all.length) }));
		T.FAMILIES.forEach(function (f) {
			var c = all.filter(function (a) { return a.family === f.key; }).length;
			if (c) { var ch = chip(f.name + ' ' + c, '#/artists?family=' + f.key, familyHue(f.key)); if (fam === f.key) ch.classList.add('is-on'); chips.appendChild(ch); }
		});
		view.appendChild(chips);
		var list = all.filter(function (a) { return (!fam || a.family === fam) && (!filt || Parse.fold(a.name + ' ' + a.native).indexOf(Parse.fold(filt)) >= 0); });
		list.sort(sort === 'name' ? function (a, b) { return cmp(a.name, b.name); } : sort === 'plays' ? function (a, b) { return b.plays - a.plays || b.tracks.length - a.tracks.length; } : function (a, b) { return b.tracks.length - a.tracks.length || cmp(a.name, b.name); });
		if (!list.length) view.appendChild(h('p', { class: 'ts-empty', text: 'No artist matches.' }));
		var g = grid(view, list.slice(0, 240).map(artistCard), 'is-cards');
		if (list.length > 240) {
			var more = h('button', { class: 'kit-btn ts-more', text: 'Show all ' + n(list.length) });
			more.addEventListener('click', function () { list.slice(240).forEach(function (a) { g.appendChild(artistCard(a)); }); more.parentNode.removeChild(more); });
			view.appendChild(more);
		}
		if (ix.needs.unsure) view.appendChild(h('a', { class: 'ts-needs', href: '#/fix' }, [icon('fix'), h('span', { text: plural(ix.needs.unsure, 'track') + ' have no sure artist yet and are not listed here.' })]));
	}
	function viewArtist(view, parts) {
		var key = parts[0], ix = idx(), a = ix.artists[key];
		if (!a) { view.appendChild(h('p', { class: 'ts-empty', text: 'No artist here. It may have been renamed or merged.' })); return; }
		var genresCount = {};
		a.tracks.forEach(function (t) { t.genres.forEach(function (g) { genresCount[g] = (genresCount[g] || 0) + 1; }); });
		var topGenres = Object.keys(genresCount).sort(function (x, y) { return genresCount[y] - genresCount[x]; }).slice(0, 5);
		var hue = familyHue(a.family);
		var ctx = { label: a.name, href: link('artist', key), patch: { artists: [key] } };
		var tracks = a.tracks.slice().sort(function (x, y) { return y.plays - x.plays || (y.rating - x.rating) || SORTS.added(x, y); });
		var prof = lib.profiles[key] || {};
		headerBlock(view, {
			round: true, kicker: 'Artist' + (prof.scene ? ' ' + DOT + ' ' + (T.SCENE_NAME[prof.scene] || prof.scene) : ''), title: a.name, alt: a.native, hue: hue,
			artNode: a.cover && prefs.art && !demo ? U.art(a.cover.id, hue.h, a.name, 'ts-hero-art is-round', true, hue.s) : U.swatch(hue.h, a.name, 'ts-hero-art is-round', hue.s),
			meta: metaLine(a.tracks) + (a.plays ? ' ' + DOT + ' ' + plural(a.plays, 'play') : ''),
			chips: topGenres.map(function (g) { return chip(g, link('genre', g), T.hueOf(g)); }),
			actions: [
				actionBtn('play', 'Play', function () { playIds(tracks.map(function (t) { return t.id; }), 0, ctx); }, true),
				shuffleSplit({ artists: [key] }, ctx),
				actionBtn('radio', 'Artist radio', function () { artistRadio(key); }),
				actionBtn('compass', 'Discover', function () { location.hash = '#/discover?artist=' + encodeURIComponent(key); }),
				actionBtn('edit', 'Edit all', function () { openEditor(a.tracks.map(function (t) { return t.id; })); })
			].concat(scopeButtons({ artists: [key] }, a.name))
		});
		sectionHead(view, 'Songs');
		trackList(view, tracks, { context: ctx });
		var works = {};
		a.tracks.forEach(function (t) { if (t.work) works[t.work] = true; });
		var wl = Object.keys(works).map(function (w) { return ix.works[w]; }).filter(Boolean);
		if (wl.length) { sectionHead(view, 'Appears in'); shelf(view, wl.map(workCard)); }
		// similar: artists sharing the most genres, weighted by how central the genre is to both
		var mine = genresCount, total = a.tracks.length, scores = [];
		Object.keys(ix.artists).forEach(function (k) {
			if (k === key) return;
			var b = ix.artists[k], s = 0, theirs = {};
			b.tracks.forEach(function (t) { t.genres.forEach(function (g) { theirs[g] = (theirs[g] || 0) + 1; }); });
			for (var g in mine) if (theirs[g]) s += (mine[g] / total) * (theirs[g] / b.tracks.length);
			if (b.family === a.family) s += 0.05;
			if (s > 0.15) scores.push({ a: b, s: s + Math.min(b.tracks.length, 10) / 200 });
		});
		scores.sort(function (x, y) { return y.s - x.s; });
		if (scores.length) { sectionHead(view, 'Sounds like'); shelf(view, scores.slice(0, 12).map(function (x) { return artistCard(x.a); })); }
		if (!demo) artistMore(view, key, a);
	}

	// ---- Genres, families and other collections -----------------------------------------------------------

	function viewGenres(view) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Genres' }));
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Hand-made for this library: ' + n(Object.keys(ix.genres).length) + ' genres in ' + n(T.FAMILIES.filter(function (f) { return ix.families[f.key]; }).length) + ' families. Every genre plays in order or shuffles.' }));
		T.FAMILIES.forEach(function (f) {
			var fe = ix.families[f.key];
			if (!fe) return;
			var names = T.genresOfFamily(f.key, Object.keys(ix.genres)).filter(function (g) { return ix.genres[g]; });
			if (!names.length) return;
			var hd = h('div', { class: 'ts-sec-head ts-fam-head' });
			var hu = familyHue(f.key);
			hd.style.setProperty('--h', String(hu.h)); hd.style.setProperty('--s', hu.s + '%');
			hd.appendChild(h('h2', null, h('a', { href: link('family', f.key), text: f.name })));
			hd.appendChild(h('span', { class: 'ts-muted', text: f.blurb + ' ' + plural(fe.tracks.length, 'song') }));
			hd.appendChild(U.iconBtn('shuffle', 'Shuffle ' + f.name, { on: { click: function () { shuffleThese({ families: [f.key] }, { label: f.name, href: link('family', f.key) }); } } }));
			view.appendChild(hd);
			grid(view, names.sort(function (a, b) { return ix.genres[b].tracks.length - ix.genres[a].tracks.length; }).map(function (g) {
				var e = ix.genres[g], info = T.genre(g);
				return tile({ href: link('genre', g), title: g, sub: plural(e.tracks.length, 'song') + (info ? ' ' + DOT + ' ' + info.blurb : ''), hue: T.hueOf(g), cover: coverOf(e.tracks), play: function () { shuffleThese({ genres: [g] }, { label: g, href: link('genre', g) }); } });
			}), 'is-tiles');
		});
	}
	function viewFamily(view, parts) {
		var key = parts[0], f = T.family(key), ix = idx(), fe = ix.families[key];
		if (!f || !fe) { view.appendChild(h('p', { class: 'ts-empty', text: 'Nothing in this family yet.' })); return; }
		var ctx = { label: f.name, href: link('family', key), patch: { families: [key] } };
		collection(view, { kicker: 'Genre family', title: f.name, blurb: f.blurb, hue: familyHue(key), tracks: fe.tracks, ctx: ctx, sort: 'artist' });
		var names = T.genresOfFamily(key, Object.keys(ix.genres)).filter(function (g) { return ix.genres[g]; });
		var chips = h('div', { class: 'ts-chips ts-chipbar' });
		names.forEach(function (g) { chips.appendChild(chip(g + ' ' + ix.genres[g].tracks.length, link('genre', g), T.hueOf(g))); });
		var actions = view.querySelector('.ts-actions');
		if (actions) actions.parentNode.insertBefore(chips, actions.nextSibling);
	}
	function viewGenre(view, parts) {
		var g = parts[0], ix = idx(), e = ix.genres[g], info = T.genre(g);
		if (!e) { view.appendChild(h('p', { class: 'ts-empty', text: 'No songs in ' + q(g) + ' yet.' })); return; }
		var fam = T.family(T.familyOf(g));
		collection(view, { kicker: 'Genre ' + DOT + ' ' + (fam ? fam.name : 'Other'), kickerHref: fam ? link('family', fam.key) : null, title: g, blurb: info ? info.blurb : '', hue: T.hueOf(g), tracks: e.tracks, ctx: { label: g, href: link('genre', g), patch: { genres: [g] } }, sort: 'artist' });
	}
	var FACETS = {
		mood: { key: 'moods', field: 'mood', name: function (v) { return T.MOOD_NAME[v] || v; }, kicker: 'Mood', hue: function (v) { return { h: MOOD_HUE[v] || 0, s: 62 }; }, blurb: function (v) { var m = T.MOODS.filter(function (x) { return x[0] === v; })[0]; return m ? m[2] : ''; } },
		scene: { key: 'scenes', field: 'scene', name: function (v) { return T.SCENE_NAME[v] || v; }, kicker: 'Scene', hue: function (v) { return { h: SCENE_HUE[v] || 0, s: 50 }; } },
		lang: { key: 'langs', field: 'lang', name: function (v) { return T.LANG_NAME[v] || v; }, kicker: 'Language', hue: function (v) { return { h: LANG_HUE[v] || 200, s: 35 }; } },
		decade: { key: 'decades', field: 'decade', name: function (v) { return v; }, kicker: 'Decade', hue: function (v) { return { h: (parseInt(v, 10) - 1950) * 4 + 180, s: 30 }; }, blurb: function () { return 'By release year where it is known, else the year of the upload.'; } },
		role: { key: 'roles', field: 'role', name: function (v) { return T.ROLE_NAME[v] || v; }, kicker: 'Role', hue: function () { return { h: 330, s: 45 }; } },
		added: { key: 'added', match: function (t, v) { return S.addedKeys(t).indexOf(v) >= 0; }, name: function (v) { return 'Added in ' + addedName(v); }, kicker: 'When you added them', hue: addedHue, blurb: function (v) { return 'The songs you first added to your playlists in ' + addedName(v) + '.'; } }
	};
	function viewFacet(view, parts) {
		var f = FACETS[parts[0]], v = parts[1];
		if (!f) { viewHome(view); return; }
		var tracks = idx().all.filter(function (t) { return f.match ? f.match(t, v) : (t[f.field] || '') === v; });
		if (!tracks.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'Nothing here yet.' })); return; }
		var patch = {}; patch[f.key] = [v];
		collection(view, { kicker: f.kicker, title: f.name(v), blurb: f.blurb ? f.blurb(v) : '', hue: f.hue(v), tracks: tracks.filter(function (t) { return t.kind !== 'clip'; }), ctx: { label: f.name(v), href: link('c', parts[0], v), patch: patch }, sort: parts[0] === 'added' ? 'added' : 'artist', breakdown: parts[0] !== 'scene' ? 'family' : 'work' });
		if (parts[0] === 'added') addedNav(view, v);
		if (parts[0] === 'mood' || parts[0] === 'scene') facetBreakdown(view, parts[0], v);
	}
	// On an added-year page: its months; on a month page: the year and the months around it.
	function addedNav(view, v) {
		var ix = idx(), year = v.slice(0, 4);
		var months = Object.keys(ix.addedM).filter(function (k) { return k.slice(0, 4) === year; }).sort();
		var years = Object.keys(ix.addedY).sort();
		var bar = h('div', { class: 'ts-chips ts-chipbar' });
		var yi = years.indexOf(year);
		if (yi > 0) bar.appendChild(chip(String.fromCharCode(0x2190) + ' ' + years[yi - 1], link('c', 'added', years[yi - 1])));
		bar.appendChild(chip('All of ' + year + ' ' + ix.addedY[year].tracks.length, link('c', 'added', year), null, v === year ? 'is-on' : ''));
		months.forEach(function (mk) { var c = chip(MONTHS[+mk.slice(5) - 1].slice(0, 3) + ' ' + ix.addedM[mk].tracks.length, link('c', 'added', mk), addedHue(mk)); if (mk === v) c.classList.add('is-on'); bar.appendChild(c); });
		if (yi >= 0 && yi < years.length - 1) bar.appendChild(chip(years[yi + 1] + ' ' + String.fromCharCode(0x2192), link('c', 'added', years[yi + 1])));
		var actions = view.querySelector('.ts-actions');
		if (actions) actions.parentNode.insertBefore(bar, actions.nextSibling); else view.appendChild(bar);
	}

	// A collection page: header, actions, a breakdown row, the list.
	function collection(view, o) {
		var tracks = o.tracks, sort = route.query.get('sort') || o.sort || 'artist';
		var list = sorted(tracks, sort), ids = list.map(function (t) { return t.id; });
		headerBlock(view, {
			kicker: o.kicker, title: o.title, blurb: o.blurb, hue: o.hue, meta: metaLine(tracks), artNode: o.artNode,
			actions: [
				actionBtn('play', 'Play', function () { playIds(ids, 0, o.ctx); }, true),
				shuffleSplit(o.ctx.patch, o.ctx),
				actionBtn('mix', 'Open in mix builder', function () { draft = planWith(o.ctx.patch, plan.mode); editingList = null; location.hash = '#/mix'; })
			].concat(scopeButtons(o.ctx.patch, o.title))
		});
		var ix = idx();
		if (o.breakdown === 'family') {
			var counts = {};
			tracks.forEach(function (t) { var a = t.artistKey; if (a) counts[a] = (counts[a] || 0) + 1; });
			var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 12).map(function (k) { return ix.artists[k]; }).filter(Boolean);
			if (top.length > 1) { sectionHead(view, 'Artists here'); shelf(view, top.map(artistCard)); }
		} else if (o.breakdown === 'work') {
			var wc = {};
			tracks.forEach(function (t) { if (t.work) wc[t.work] = (wc[t.work] || 0) + 1; });
			var tw = Object.keys(wc).sort(function (a, b) { return wc[b] - wc[a]; }).slice(0, 14).map(function (k) { return ix.works[k]; }).filter(Boolean);
			if (tw.length) { sectionHead(view, 'Works'); shelf(view, tw.map(workCard)); }
		}
		var hd = h('div', { class: 'ts-sec-head' }, [h('h2', { text: 'Songs' })]);
		hd.appendChild(sortSelect(sort, function (v) { setQuery({ sort: v }); }));
		view.appendChild(hd);
		trackList(view, list, { context: o.ctx });
	}

	// ---- Works: the anime, visual novels, games, films and stage shows songs come from --------------

	var WORK_SORTS = [['songs', 'Most songs'], ['name', 'A to Z'], ['added', 'Recently added'], ['plays', 'Most played'], ['themes', 'Most openings and endings']];
	function workStats(w) {
		var s = { op: 0, ed: 0, insert: 0, other: 0, plays: 0, added: 0, artists: {} };
		w.tracks.forEach(function (t) {
			if (t.role === 'OP') s.op++; else if (t.role === 'ED') s.ed++; else if (t.role === 'insert') s.insert++; else s.other++;
			s.plays += t.plays || 0;
			s.added = Math.max(s.added, L.lastAdded(t) || 0);
			if (t.artist) s.artists[t.artist] = (s.artists[t.artist] || 0) + 1;
		});
		s.topArtists = Object.keys(s.artists).sort(function (a2, b2) { return s.artists[b2] - s.artists[a2]; });
		return s;
	}
	function sortWorks(list, how) {
		var st = {};
		list.forEach(function (w) { st[w.key] = workStats(w); });
		return list.sort(function (a2, b2) {
			if (how === 'name') return cmp(a2.key, b2.key);
			if (how === 'added') return st[b2.key].added - st[a2.key].added || cmp(a2.key, b2.key);
			if (how === 'plays') return st[b2.key].plays - st[a2.key].plays || b2.tracks.length - a2.tracks.length;
			if (how === 'themes') return (st[b2.key].op + st[b2.key].ed) - (st[a2.key].op + st[a2.key].ed) || b2.tracks.length - a2.tracks.length;
			return b2.tracks.length - a2.tracks.length || cmp(a2.key, b2.key);
		});
	}
	function worksEmpty(view) {
		var box = h('section', { class: 'ts-welcome' });
		box.appendChild(h('h2', { text: 'No song says yet which anime, game or show it is from' }));
		box.appendChild(h('p', { text: 'That comes from the labels: each song\u2019s work (Bocchi the Rock!, Sakura no Uta, Hamilton...) and its role there (opening, ending, insert song, score). Drop your labels file anywhere on this page, or choose it here, and this tab fills in.' }));
		var inp = h('input', { class: 'kit-sr', type: 'file', id: 'works-labels-file', accept: 'application/json,.json' });
		inp.addEventListener('change', function () { var f = inp.files[0]; if (f) applyLabelsFile(f); inp.value = ''; });
		box.appendChild(inp);
		box.appendChild(h('div', { class: 'ts-row-btns' }, [h('label', { class: 'kit-btn primary', for: 'works-labels-file' }, [icon('upload'), ' Apply a labels file']), h('a', { class: 'kit-btn', href: '#/label', text: 'Label songs one by one' })]));
		view.appendChild(box);
	}
	function viewWorks(view, parts, query) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var filt = query.get('f') || '', scene = query.get('scene') || '', sort = query.get('sort') || ToyKit.load('worksSort', 'songs'), mode = query.get('view') || ToyKit.load('worksView', 'grid');
		var all = Object.keys(ix.works).map(function (k) { return ix.works[k]; });
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Anime, games & stage' }));
		if (!all.length) { worksEmpty(view); return; }
		var songs = 0;
		all.forEach(function (w) { songs += w.tracks.length; });
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: plural(songs, 'song') + ' from ' + plural(all.length, 'work') + ': openings, endings, insert songs, character songs, scores, and covers of them.' }));
		// controls
		var bar = h('div', { class: 'ts-filterbar' });
		var fi = h('input', { class: 'kit-input ts-filter', type: 'search', placeholder: 'Find an anime, game or musical', value: filt, aria: { label: 'Find a work' } });
		fi.addEventListener('input', later(function () { setQuery({ f: fi.value || null }); }, 250));
		bar.appendChild(fi);
		bar.appendChild(sortSelect(sort, function (v) { ToyKit.store('worksSort', v); setQuery({ sort: v }); }, WORK_SORTS));
		var seg = h('div', { class: 'ts-seg', role: 'radiogroup', aria: { label: 'View' } });
		[['grid', 'Grid'], ['list', 'List']].forEach(function (o2) { seg.appendChild(h('button', { class: 'ts-seg-b', role: 'radio', aria: { checked: mode === o2[0] ? 'true' : 'false' }, text: o2[1], on: { click: function () { ToyKit.store('worksView', o2[0]); setQuery({ view: o2[0] }); } } })); });
		bar.appendChild(seg);
		view.appendChild(bar);
		var chips = h('div', { class: 'ts-chips ts-chipbar' });
		chips.appendChild(h('a', { class: 'ts-chip' + (scene ? '' : ' is-on'), href: '#/works', text: 'All ' + all.length }));
		T.SCENES.forEach(function (s2) {
			var c = all.filter(function (w) { return w.scene === s2[0]; }).length;
			if (c) { var ch = chip(s2[1] + ' ' + c, '#/works?scene=' + s2[0], { h: SCENE_HUE[s2[0]], s: 45 }); if (scene === s2[0]) ch.classList.add('is-on'); chips.appendChild(ch); }
		});
		var noScene = all.filter(function (w) { return !w.scene; }).length;
		if (noScene) { var ch2 = chip('Other ' + noScene, '#/works?scene=none'); if (scene === 'none') ch2.classList.add('is-on'); chips.appendChild(ch2); }
		view.appendChild(chips);
		var ff = Parse.fold(filt);
		var list = all.filter(function (w) {
			if (scene === 'none' ? w.scene : scene && w.scene !== scene) return false;
			if (!ff) return true;
			var st = workStats(w);
			return Parse.fold(w.key + ' ' + st.topArtists.join(' ')).indexOf(ff) >= 0;
		});
		sortWorks(list, sort);
		if (!list.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'No work matches.' })); return; }
		if (mode === 'list') { worksTable(view, list); return; }
		// grid: by scene when everything is shown, the one-song works folded away
		var groups = scene || ff || sort !== 'songs' ? [{ key: scene, works: list }] : T.SCENES.map(function (s2) { return { key: s2[0], works: list.filter(function (w) { return w.scene === s2[0]; }) }; }).concat([{ key: '', works: list.filter(function (w) { return !w.scene; }) }]).filter(function (g) { return g.works.length; });
		groups.forEach(function (g) {
			var big = g.works.filter(function (w) { return w.tracks.length > 1 || ff; }), small = g.works.filter(function (w) { return w.tracks.length === 1 && !ff; });
			if (groups.length > 1) {
				var hd = h('div', { class: 'ts-sec-head ts-fam-head' });
				var hue = { h: SCENE_HUE[g.key] || 210, s: 45 };
				hd.style.setProperty('--h', String(hue.h)); hd.style.setProperty('--s', hue.s + '%');
				var count = 0;
				g.works.forEach(function (w) { count += w.tracks.length; });
				hd.appendChild(h('h2', null, h('a', { href: '#/works?scene=' + (g.key || 'none'), text: g.key ? T.SCENE_NAME[g.key] : 'Other' })));
				hd.appendChild(h('span', { class: 'ts-muted', text: plural(g.works.length, 'work') + ' ' + DOT + ' ' + plural(count, 'song') }));
				if (g.key) hd.appendChild(shuffleSplit({ scenes: [g.key] }, { label: T.SCENE_NAME[g.key], href: '#/works?scene=' + g.key, patch: { scenes: [g.key] } }));
				view.appendChild(hd);
			}
			if (big.length) grid(view, big.map(workCard), 'is-cards');
			if (small.length) {
				var det = h('details', { class: 'ts-onesong' }, [h('summary', { text: plural(small.length, 'more work') + ' with one song' })]);
				var cl = h('div', { class: 'ts-chips' });
				small.forEach(function (w) { cl.appendChild(h('a', { class: 'ts-chip', href: link('work', w.key), title: trackTitle(w.tracks[0]) + ' ' + DOT + ' ' + trackArtist(w.tracks[0]) }, [h('span', { text: w.key }), w.tracks[0].role ? h('span', { class: 'ts-count', text: w.tracks[0].role }) : null])); });
				det.appendChild(cl);
				view.appendChild(det);
			}
		});
	}
	// The list view: one row per work, its numbers, its artists.
	function worksTable(view, list) {
		var tbl = h('table', { class: 'ts-wtable' });
		tbl.appendChild(h('thead', null, h('tr', null, [h('th', { scope: 'col' }), h('th', { scope: 'col', text: 'Work' }), h('th', { scope: 'col', text: 'Scene' }), h('th', { scope: 'col', class: 'is-num', text: 'Songs' }), h('th', { scope: 'col', class: 'is-num', text: 'OP' }), h('th', { scope: 'col', class: 'is-num', text: 'ED' }), h('th', { scope: 'col', text: 'Artists' }), h('th', { scope: 'col', class: 'is-num', text: 'Time' }), h('th', { scope: 'col' })])));
		var tb = h('tbody');
		list.forEach(function (w) {
			var st = workStats(w), ids = sorted(w.tracks, 'work').map(function (t) { return t.id; });
			var tr = h('tr');
			tr.appendChild(h('td', null, w.cover ? artFor(w.cover, 'ts-wt-art') : U.swatch(SCENE_HUE[w.scene] || 210, w.key, 'ts-wt-art')));
			tr.appendChild(h('td', null, h('a', { href: link('work', w.key), class: 'ts-wt-name', text: w.key })));
			tr.appendChild(h('td', { class: 'ts-muted', text: T.SCENE_NAME[w.scene] || '' }));
			tr.appendChild(h('td', { class: 'is-num', text: String(w.tracks.length) }));
			tr.appendChild(h('td', { class: 'is-num', text: st.op ? String(st.op) : '' }));
			tr.appendChild(h('td', { class: 'is-num', text: st.ed ? String(st.ed) : '' }));
			tr.appendChild(h('td', { class: 'ts-muted ts-wt-artists', text: st.topArtists.slice(0, 3).join(', ') + (st.topArtists.length > 3 ? ' +' + (st.topArtists.length - 3) : '') }));
			tr.appendChild(h('td', { class: 'is-num ts-muted', text: longTime(secs(w.tracks)) }));
			tr.appendChild(h('td', null, U.iconBtn('play', 'Play ' + w.key, { on: { click: function () { playIds(ids, 0, { label: w.key, href: link('work', w.key), patch: { works: [w.key] } }); } } })));
			tb.appendChild(tr);
		});
		tbl.appendChild(tb);
		view.appendChild(h('div', { class: 'ts-wtable-wrap' }, tbl));
	}

	// One work: its songs by role, its artists, related works.
	var ROLE_SECTIONS = [
		['OP', 'Openings', function (t) { return t.role === 'OP' && !coverish(t); }],
		['ED', 'Endings', function (t) { return t.role === 'ED' && !coverish(t); }],
		['insert', 'Insert songs', function (t) { return t.role === 'insert' && !coverish(t); }],
		['theme', 'Theme songs', function (t) { return t.role === 'theme' && !coverish(t); }],
		['image', 'Character and image songs', function (t) { return t.role === 'image' && !coverish(t); }],
		['OST', 'Score', function (t) { return t.role === 'OST' && !coverish(t); }],
		['cover', 'Covers and arrangements', function (t) { return coverish(t); }],
		['', 'Other', function () { return true; }]
	];
	function coverish(t) { return !!t.origArtist || /cover|piano|orchestral|acoustic|remix|karaoke/.test(t.version || ''); }
	function viewWork(view, parts) {
		var w = parts[0], e = idx().works[w];
		if (!e) { view.appendChild(h('p', { class: 'ts-empty', text: 'No songs from ' + q(w) + ' here' + (focus ? ' while focused on ' + q((listById(focus) || {}).name) : '') + '.' })); return; }
		var st = workStats(e), years = e.tracks.map(function (t) { return t.year; }).filter(Boolean).sort();
		var all = sorted(e.tracks, 'work'), ids = all.map(function (t) { return t.id; }), ctx = { label: w, href: link('work', w), patch: { works: [w] } };
		var hue = { h: SCENE_HUE[e.scene] || 210, s: 45 };
		headerBlock(view, {
			kicker: T.SCENE_NAME[e.scene] || 'Work', title: w, hue: hue, artNode: e.cover ? artFor(e.cover, 'ts-hero-art') : null,
			blurb: st.topArtists.slice(0, 6).join(', ') + (st.topArtists.length > 6 ? ' and ' + (st.topArtists.length - 6) + ' more' : ''),
			meta: metaLine(e.tracks) + roleSummary(e.tracks) + (years.length ? ' ' + DOT + ' ' + (years[0] === years[years.length - 1] ? years[0] : years[0] + NDASH + years[years.length - 1]) : '') + (st.plays ? ' ' + DOT + ' ' + plural(st.plays, 'play') : ''),
			actions: [
				actionBtn('play', 'Play', function () { playIds(ids, 0, ctx); }, true),
				shuffleSplit(ctx.patch, ctx),
				actionBtn('edit', 'Edit all', function () { openEditor(ids); })
			].concat(scopeButtons({ works: [w] }, w))
		});
		// jump links to the sections
		var used = {}, sections = [];
		ROLE_SECTIONS.forEach(function (rs) {
			var ts = all.filter(function (t) { return !used[t.id] && rs[2](t); });
			ts.forEach(function (t) { used[t.id] = true; });
			if (ts.length) sections.push({ key: rs[0], name: rs[1], tracks: ts });
		});
		if (sections.length > 1) {
			var jump = h('div', { class: 'ts-chips ts-chipbar' });
			sections.forEach(function (s2) { jump.appendChild(h('button', { class: 'ts-chip', on: { click: function () { var t0 = view.querySelector('[data-sec="' + (s2.key || 'other') + '"]'); if (t0) t0.scrollIntoView({ block: 'start', behavior: ToyKit.reducedMotion ? 'auto' : 'smooth' }); } } }, [h('span', { text: s2.name }), h('span', { class: 'ts-count', text: String(s2.tracks.length) })])); });
			view.appendChild(jump);
		}
		sections.forEach(function (s2) {
			var hd = h('div', { class: 'ts-sec-head', data: { sec: s2.key || 'other' } }, [h('h2', { text: s2.name }), h('span', { class: 'ts-muted', text: plural(s2.tracks.length, 'song') + ' ' + DOT + ' ' + longTime(secs(s2.tracks)) })]);
			var sids = s2.tracks.map(function (t) { return t.id; });
			hd.appendChild(U.iconBtn('play', 'Play the ' + s2.name.toLowerCase(), { text: true, cls: 'ts-act', on: { click: function () { playIds(sids, 0, { label: w + ': ' + s2.name, href: link('work', w), patch: s2.key && s2.key !== 'cover' ? { works: [w], roles: [s2.key] } : { works: [w] } }); } } }));
			view.appendChild(hd);
			trackList(view, s2.tracks, { context: { label: w + ': ' + s2.name, href: link('work', w) }, noWork: true, noHead: true });
		});
		// the artists, and works that share them
		var ix = idx(), artistKeys = {};
		e.tracks.forEach(function (t) { if (t.artistKey) artistKeys[t.artistKey] = (artistKeys[t.artistKey] || 0) + 1; });
		var ak = Object.keys(artistKeys).sort(function (a2, b2) { return artistKeys[b2] - artistKeys[a2]; }).map(function (k) { return ix.artists[k]; }).filter(Boolean);
		if (ak.length) { sectionHead(view, 'Artists here'); shelf(view, ak.slice(0, 16).map(artistCard)); }
		var rel = {};
		Object.keys(ix.works).forEach(function (o) {
			if (o === w) return;
			var s3 = 0;
			ix.works[o].tracks.forEach(function (t) { if (t.artistKey && artistKeys[t.artistKey]) s3 += 2; });
			if (ix.works[o].scene === e.scene) s3 += 0.5;
			if (s3 >= 2) rel[o] = s3;
		});
		var relList = Object.keys(rel).sort(function (a2, b2) { return rel[b2] - rel[a2]; }).slice(0, 14).map(function (k) { return ix.works[k]; });
		if (relList.length) { sectionHead(view, 'Shares artists with'); shelf(view, relList.map(workCard)); }
	}

	// ---- One track ------------------------------------------------------------------------------------------

	function viewTrack(view, parts) {
		var t = lib.tracks[parts[0]];
		if (!t) { view.appendChild(h('p', { class: 'ts-empty', text: 'This track is not in the library.' })); return; }
		var chips = h('div', { class: 'ts-chips' });
		labelChips(t, chips);
		headerBlock(view, {
			kicker: 'Song' + (t.work ? ' ' + DOT + ' ' + t.work + (t.role ? ' ' + t.role : '') : ''), title: trackTitle(t), alt: t.titleAlt, hue: trackHue(t), artNode: artFor(t, 'ts-hero-art'),
			meta: [trackArtist(t), t.origArtist ? 'original by ' + t.origArtist : '', versionWords(t), t.durationSec ? clock(t.durationSec) : '', plural(t.plays, 'play')].filter(Boolean).join(' ' + DOT + ' '),
			chips: Array.prototype.slice.call(chips.childNodes),
			actions: [
				actionBtn('play', 'Play', function () { playIds([t.id], 0, { label: trackTitle(t), href: link('track', t.id) }); }, true),
				actionBtn('radio', 'Start radio', function () { startRadio(t); }),
				actionBtn('edit', 'Edit details', function () { openEditor([t.id]); }),
				!demo && U.YT_ID.test(t.id) && ytTargets().some(function (p) { return !inPlaylist(t.id, p); }) ? actionBtn('plus', addLabel() + ' on YouTube', function (e) { addToYouTube({ id: t.id, artist: t.artist, title: trackTitle(t), _video: { videoId: t.id } }, e.currentTarget); }) : null,
				U.iconBtn('more', 'More', { on: { click: function (e) { trackMenu(t, e.currentTarget, null); } } })
			]
		});
		view.appendChild(stars(t));
		if (isGuess(t)) view.appendChild(guessBox(t));
		var facts = h('dl', { class: 'ts-facts' });
		function fact(k, v) { if (v) { facts.appendChild(h('dt', { text: k })); facts.appendChild(h('dd', { text: v })); } }
		fact('On YouTube', t.raw.title);
		if (t.channelId) { facts.appendChild(h('dt', { text: 'Channel' })); facts.appendChild(h('dd', null, h('a', { href: link('channel', t.channelId), text: t.channel }))); } else fact('Channel', t.channel);
		fact('Year', t.year ? t.year + (t.yearSource === 'upload' ? ' (upload)' : '') : '');
		fact('Added', L.firstAdded(t) ? new Date(L.firstAdded(t)).toISOString().slice(0, 10) : '');
		fact('Last played', t.lastPlayed ? String(t.lastPlayed).slice(0, 10) : 'never');
		fact('Skipped', t.skips ? plural(t.skips, 'time') : '');
		fact('Labels', t.labels ? 'from a labels file' + (Object.keys(t.userEdits).length ? ', with your corrections' : '') : (Object.keys(t.userEdits).length ? 'your corrections' : 'what YouTube says'));
		fact('Status', !L.playable(t) ? 'cannot be played here' : t.blocked ? 'blocked' : '');
		view.appendChild(facts);
		var radio = radioIds(t, 40).slice(1, 21).map(function (id) { return lib.tracks[id]; });
		if (radio.length) { sectionHead(view, 'Sounds like this'); trackList(view, radio, { context: { label: 'Radio: ' + trackTitle(t), href: link('track', t.id) } }); }
	}

	// ---- The library hub (phones) ---------------------------------------------------------------------------

	function viewLibrary(view) {
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Library' }));
		var ix = idx();
		var items = [
			['songs', 'Songs', 'songs', plural(ix.music.length, 'song')], ['artists', 'Artists', 'artist', plural(Object.keys(ix.artists).length, 'artist')],
			['genres', 'Genres', 'genre', plural(Object.keys(ix.genres).length, 'genre')], ['browse', 'Moods & scenes', 'mood', 'Moods, scenes, languages, decades'],
			['works', 'Anime, games & stage', 'works', plural(Object.keys(ix.works).length, 'work')], ['stats', 'Your numbers', 'stats', 'What you have and play'],
			['discover', 'Discover', 'compass', 'New songs like the ones you love'], ['lists', 'Playlists', 'list', plural(lists.length, 'playlist')], ['map', 'Map', 'map', 'Your library as a map of sound'], ['history', 'History', 'history', 'What you played'], ['label', 'Quick labeller', 'edit', plural(idx().all.filter(needsLabel).length, 'song') + ' to label'],
			['fix', 'Needs attention', 'fix', ix.needs.unsure ? plural(ix.needs.unsure, 'unsure artist') : 'All good'], ['settings', 'Settings', 'settings', 'Import, labels, backup, privacy']
		];
		var ul = h('ul', { class: 'ts-hub' });
		items.forEach(function (it) { ul.appendChild(h('li', null, h('a', { href: '#/' + it[0] }, [icon(it[2]), h('span', null, [h('b', { text: it[1] }), h('span', { class: 'ts-muted', text: it[3] })])]))); });
		view.appendChild(ul);
	}

	// ---- The mix builder ------------------------------------------------------------------------------------

	var draft = null;   // the plan being built; null: start from the current plan
	function viewMix(view) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		if (!draft) draft = copyPlan(plan);
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Mix builder' }));
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Pick what goes in and how it is ordered. Within one row the choices are alternatives (City pop or Anison pop); different rows must all hold (and wistful, and Japanese).' }));
		var summary = h('div', { class: 'ts-mixsum', aria: { live: 'polite' } });
		view.appendChild(summary);
		function refresh() {
			clear(summary);
			var chosen = chosenTracks(draft);
			summary.appendChild(h('p', { class: 'ts-mixsum-n' }, [h('b', { text: plural(chosen.length, 'song') }), ' ' + DOT + ' ' + longTime(secs(chosen)) + ' ' + DOT + ' ' + modeName(draft.mode)]));
			var words = mixWords(draft);
			summary.appendChild(h('p', { class: 'ts-muted', text: words || 'Everything (no clips).' }));
			var row = h('div', { class: 'ts-row-btns' });
			var go = actionBtn('play', 'Play this mix', function () { plan = copyPlan(draft); context = { label: 'Mix', href: '#/mix', patch: patchOf(draft) }; applyPlan({ play: true }); }, true);
			go.disabled = !chosen.length;
			row.appendChild(go);
			var editing = editingList && listById(editingList);
			if (editing) row.appendChild(actionBtn('check', 'Update ' + editing.name, function () { editing.patch = patchOf(draft); editing.mode = draft.mode; delete editing.auto; saveLists(); if (focus === editing.id) setFocus(editing.id, true); say('Updated ' + q(editing.name) + '.'); location.hash = link('list', editing.id); }));
			row.appendChild(actionBtn('plus', editing ? 'Save as a new playlist' : 'Save as playlist', function () { createList('smart', { patch: patchOf(draft), mode: draft.mode }, suggestName(draft), { focus: false }); }));
			row.appendChild(actionBtn('close', 'Start over', function () { draft = copyPlan(DEFAULT_PLAN); draft.mode = plan.mode; renderView(true); }));
			summary.appendChild(row);
		}
		function saveStation() {
			var d = U.openDialog({ title: 'Save as a station' });
			var f = h('form', { class: 'ts-edit' });
			var inp = h('input', { class: 'kit-input', type: 'text', placeholder: 'A name, e.g. Wistful anime nights', aria: { label: 'Station name' } });
			inp.value = suggestName(draft);
			f.appendChild(inp);
			f.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'kit-btn primary', type: 'submit', text: 'Save' }), h('button', { class: 'kit-btn', text: 'Cancel', on: { click: d.close } })]));
			f.addEventListener('submit', function (e) {
				e.preventDefault();
				var name = inp.value.trim();
				if (!name) { inp.focus(); return; }
				stations = stations.filter(function (s) { return s.name !== name; });
				stations.push({ name: name, plan: copyPlan(draft) });
				store.set('presets', stations);
				d.close();
				renderStations();
				say('Saved ' + q(name) + '. It is under Stations.');
			});
			d.body.appendChild(f);
			inp.focus();
			inp.select();
		}
		// order
		sectionHead(view, 'Order');
		var modes = h('div', { class: 'ts-modes', role: 'radiogroup', aria: { label: 'Order' } });
		ORDER.forEach(function (o) {
			var m = modeInfo(o.key), on = draft.mode === o.key;
			var b = h('button', { class: 'ts-modecard' + (on ? ' is-on' : ''), role: 'radio', aria: { checked: on ? 'true' : 'false' } }, [icon(o.icon), h('b', { text: modeName(o.key) }), h('span', { text: m.blurb })]);
			b.addEventListener('click', function () { draft.mode = o.key; renderView(true); });
			modes.appendChild(b);
		});
		view.appendChild(modes);
		// filters
		function pickRow(title, key, entries, opts) {
			opts = opts || {};
			entries = entries.filter(function (e) { return e.count; });
			if (!entries.length) return;
			var box = h('div', { class: 'ts-pickrow' });
			var hd = h('div', { class: 'ts-pick-h' }, [h('h3', { text: title })]);
			if (draft[key].length) hd.appendChild(h('button', { class: 'ts-link-btn', text: 'Clear', on: { click: function () { draft[key] = []; renderView(true); } } }));
			box.appendChild(hd);
			var row = h('div', { class: 'ts-chips' });
			var shown = opts.max && !opts.all ? entries.slice(0, opts.max) : entries;
			entries.forEach(function (e) { if (draft[key].indexOf(e.key) >= 0 && shown.indexOf(e) < 0) shown.push(e); });
			shown.forEach(function (e) {
				var on = draft[key].indexOf(e.key) >= 0;
				var c = h('button', { class: 'ts-chip' + (on ? ' is-on' : '') + (e.hue ? ' is-hued' : ''), aria: { pressed: on ? 'true' : 'false' } }, [h('span', { text: e.name }), h('span', { class: 'ts-count', text: n(e.count) })]);
				if (e.hue) { c.style.setProperty('--h', String(Math.round(e.hue.h))); c.style.setProperty('--s', e.hue.s + '%'); }
				c.addEventListener('click', function () { var at = draft[key].indexOf(e.key); if (at >= 0) draft[key].splice(at, 1); else draft[key].push(e.key); renderView(true); });
				row.appendChild(c);
			});
			if (opts.max && entries.length > shown.length) row.appendChild(h('button', { class: 'ts-link-btn', text: 'and ' + n(entries.length - shown.length) + ' more', on: { click: function () { opts.all = true; expanded[key] = true; renderView(true); } } }));
			box.appendChild(row);
			view.appendChild(box);
		}
		sectionHead(view, 'What goes in');
		pickRow('Families', 'families', T.FAMILIES.map(function (f) { return { key: f.key, name: f.name, count: ix.families[f.key] ? ix.families[f.key].tracks.length : 0, hue: familyHue(f.key) }; }));
		var gnames = Object.keys(ix.genres).sort(function (a, b) { return ix.genres[b].tracks.length - ix.genres[a].tracks.length; });
		pickRow('Genres', 'genres', gnames.map(function (g) { return { key: g, name: g, count: ix.genres[g].tracks.length, hue: T.hueOf(g) }; }), { max: 24, all: expanded.genres });
		pickRow('Moods', 'moods', T.MOODS.map(function (m) { return { key: m[0], name: m[1], count: ix.moods[m[0]] ? ix.moods[m[0]].tracks.length : 0, hue: { h: MOOD_HUE[m[0]], s: 60 } }; }));
		pickRow('Scenes', 'scenes', T.SCENES.map(function (s) { return { key: s[0], name: s[1], count: ix.scenes[s[0]] ? ix.scenes[s[0]].tracks.length : 0 }; }));
		pickRow('Languages', 'langs', T.LANGS.map(function (l) { return { key: l[0], name: l[1], count: ix.langs[l[0]] ? ix.langs[l[0]].tracks.length : 0 }; }));
		pickRow('Roles', 'roles', T.ROLES.map(function (r) { return { key: r[0], name: r[1], count: ix.all.filter(function (t) { return t.role === r[0]; }).length }; }));
		pickRow('Added in (year)', 'added', Object.keys(ix.addedY).sort().reverse().map(function (y) { return { key: y, name: y, count: ix.addedY[y].tracks.length, hue: addedHue(y) }; }));
		var pickedYears = draft.added.filter(function (k) { return k.length === 4; });
		var monthKeys = Object.keys(ix.addedM).sort().reverse().filter(function (k) { return !pickedYears.length || pickedYears.indexOf(k.slice(0, 4)) >= 0 || draft.added.indexOf(k) >= 0; });
		pickRow(pickedYears.length ? 'Added in (month of ' + pickedYears.join(', ') + ')' : 'Added in (month)', 'added', monthKeys.map(function (k) { return { key: k, name: addedName(k), count: ix.addedM[k].tracks.length }; }), { max: 12, all: expanded.added });
		pickRow('Decades', 'decades', Object.keys(ix.decades).sort().map(function (dk) { return { key: dk, name: dk, count: ix.decades[dk].tracks.length }; }));
		var fl = L.facets(lib, ix.all, now());
		pickRow('Length', 'lengths', fl.length.map(function (e) { return { key: e.key, name: e.name, count: e.count }; }));
		pickRow('Works', 'works', Object.keys(ix.works).sort(function (a, b) { return ix.works[b].tracks.length - ix.works[a].tracks.length; }).map(function (w) { return { key: w, name: w, count: ix.works[w].tracks.length }; }), { max: 18, all: expanded.works });
		pickRow('Artists', 'artists', Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).sort(function (a, b) { return b.tracks.length - a.tracks.length; }).map(function (a) { return { key: a.key, name: a.name, count: a.tracks.length }; }), { max: 24, all: expanded.artists });
		if (Object.keys(lib.playlists).length > 1) pickRow('Playlists', 'playlists', fl.playlist.map(function (e) { return { key: e.key, name: e.name, count: e.count }; }));
		// limits
		sectionHead(view, 'Limits');
		var lim = h('div', { class: 'ts-limits' });
		function num(label, key, hint) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'number', min: '0', placeholder: hint });
			inp.value = draft[key] || '';
			inp.addEventListener('change', function () { var v = parseInt(inp.value, 10); draft[key] = v > 0 ? v : null; renderView(true); });
			lab.appendChild(inp);
			lim.appendChild(lab);
		}
		num('Stop after (tracks)', 'maxTracks', 'no limit');
		num('Stop after (minutes)', 'maxMinutes', 'no limit');
		num('Skip what played in the last (hours)', 'hours', 'none');
		function day(label, key) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'date' });
			inp.value = draft[key] || '';
			inp.addEventListener('change', function () { draft[key] = inp.value || ''; renderView(true); });
			lab.appendChild(inp);
			lim.appendChild(lab);
		}
		day('Added on or after', 'addedFrom');
		day('Added on or before', 'addedTo');
		function check(label, key) {
			var lab = h('label', { class: 'ts-check' });
			var cb = h('input', { type: 'checkbox', checked: !!draft[key] });
			cb.addEventListener('change', function () { draft[key] = cb.checked; renderView(true); });
			lab.appendChild(cb);
			lab.appendChild(h('span', { text: label }));
			lim.appendChild(lab);
		}
		check('Keep numbered parts together (Pt. 1, Pt. 2)', 'keepRuns');
		check('Include clips (videos that are not music)', 'clips');
		check('Keep songs from one anime or game apart (all orders but the true shuffle)', 'apart');
		check('One version of each song (the original or one cover, not all of them)', 'oneVersion');
		view.appendChild(lim);
		refresh();
	}
	var expanded = {};
	function mixWords(p) {
		var ix = idx(), parts = [];
		if (p.families.length) parts.push(p.families.map(function (k) { return (T.family(k) || {}).name || k; }).join(' or '));
		if (p.genres.length) parts.push(p.genres.join(' or '));
		if (p.moods.length) parts.push(p.moods.map(function (m) { return (T.MOOD_NAME[m] || m).toLowerCase(); }).join(' or '));
		if (p.scenes.length) parts.push(p.scenes.map(function (s) { return T.SCENE_NAME[s] || s; }).join(' or '));
		if (p.langs.length) parts.push(p.langs.map(function (l) { return T.LANG_NAME[l] || l; }).join(' or '));
		if (p.roles.length) parts.push(p.roles.map(function (r) { return T.ROLE_NAME[r] || r; }).join(' or '));
		if (p.decades.length) parts.push(p.decades.join(' or '));
		if (p.works.length) parts.push('from ' + p.works.join(' or '));
		if (p.text) parts.push('matching ' + q(p.text));
		if (p.minRating > 0) parts.push('liked or rated ' + p.minRating + '+');
		if (p.added && p.added.length) parts.push('added in ' + p.added.map(addedName).join(' or '));
		if (p.addedFrom || p.addedTo) parts.push('added ' + (p.addedFrom && p.addedTo ? 'between ' + p.addedFrom + ' and ' + p.addedTo : p.addedFrom ? 'since ' + p.addedFrom : 'until ' + p.addedTo));
		if (p.artists.length) parts.push('by ' + p.artists.map(function (k) { return ix.artists[k] ? ix.artists[k].name : k; }).join(' or '));
		if (p.lengths.length) parts.push(p.lengths.map(function (k) { return k; }).join(' or ') + ' length');
		var lim = [];
		if (p.maxTracks > 0) lim.push('stops after ' + plural(+p.maxTracks, 'track'));
		if (p.maxMinutes > 0) lim.push('stops after ' + longTime(p.maxMinutes * 60));
		if (p.hours > 0) lim.push('skips what played in the last ' + plural(+p.hours, 'hour'));
		return capital(parts.join('; ')) + (parts.length && lim.length ? '. ' : '') + capital(lim.join(', ')) + (parts.length || lim.length ? '.' : '');
	}
	function suggestName(p) {
		var bits = [];
		if (p.moods.length === 1) bits.push(T.MOOD_NAME[p.moods[0]]);
		if (p.genres.length === 1) bits.push(p.genres[0]);
		else if (p.families.length === 1) bits.push((T.family(p.families[0]) || {}).name);
		if (p.scenes.length === 1) bits.push(T.SCENE_NAME[p.scenes[0]]);
		if (p.works.length === 1) bits.push(p.works[0]);
		if (p.added && p.added.length === 1) bits.push('added ' + addedName(p.added[0]));
		return bits.filter(Boolean).join(' ') || 'My mix';
	}

	// ---- Your numbers -------------------------------------------------------------------------------------
	// Single-series bar lists: one hue for magnitude, the value written beside
	// each bar in text colour, a tooltip with the exact count and share.

	function bars(view, title, rows, note) {
		rows = rows.filter(function (r) { return r.value > 0; });
		if (!rows.length) return;
		var total = 0, max = 0;
		rows.forEach(function (r) { total += r.value; max = Math.max(max, r.value); });
		var box = h('figure', { class: 'ts-bars' });
		box.appendChild(h('figcaption', null, [h('h3', { text: title }), note ? h('span', { class: 'ts-muted', text: note }) : null]));
		var tbl = h('table', { class: 'ts-bars-t' });
		tbl.appendChild(h('thead', { class: 'kit-sr' }, h('tr', null, [h('th', { scope: 'col', text: 'Name' }), h('th', { scope: 'col', text: 'Count' }), h('th', { scope: 'col', text: 'Bar' })])));
		var tb = h('tbody');
		rows.forEach(function (r) {
			var pct = total ? Math.round(1000 * r.value / total) / 10 : 0;
			var tr = h('tr', { title: r.name + ': ' + n(r.value) + (r.unit ? ' ' + r.unit : '') + ' (' + pct + '%)' });
			tr.appendChild(h('th', { scope: 'row' }, r.href ? h('a', { href: r.href, text: r.name }) : r.name));
			tr.appendChild(h('td', { class: 'ts-bars-v', text: r.label || n(r.value) }));
			var cell = h('td', { class: 'ts-bars-c', aria: { hidden: 'true' } });
			cell.appendChild(h('span', { class: 'ts-bars-bar', style: { width: Math.max(1.5, 100 * r.value / max) + '%' } }));
			tr.appendChild(cell);
			tb.appendChild(tr);
		});
		tbl.appendChild(tb);
		box.appendChild(tbl);
		view.appendChild(box);
	}
	function viewStats(view) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var s = L.stats(lib, now());
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Your numbers' }));
		var tiles = h('div', { class: 'ts-stattiles' });
		function stat(v, l) { tiles.appendChild(h('div', { class: 'ts-stat' }, [h('span', { class: 'ts-stat-v', text: v }), h('span', { class: 'ts-stat-l', text: l })])); }
		stat(n(ix.music.length), 'songs, ' + n(playable(ix.music).length) + ' playable' + (ix.all.length > ix.music.length ? ' (and ' + plural(ix.all.length - ix.music.length, 'clip') + ')' : ''));
		stat(n(Object.keys(ix.artists).length), 'artists');
		stat(longTime(secs(ix.music)), 'to hear everything once');
		stat(n(s.plays), 'plays, ' + n(s.skips) + ' skips');
		stat((s.tracks ? Math.round(100 * s.neverPlayed / s.tracks) : 0) + '%', 'never played');
		view.appendChild(tiles);
		var cols = h('div', { class: 'ts-statcols' });
		view.appendChild(cols);
		bars(cols, 'Genre families', T.FAMILIES.map(function (f) { return { name: f.name, href: link('family', f.key), value: ix.families[f.key] ? ix.families[f.key].tracks.length : 0 }; }).sort(function (a, b) { return b.value - a.value; }), 'songs; a song can sit in two families');
		bars(cols, 'Top genres', Object.keys(ix.genres).map(function (g) { return { name: g, href: link('genre', g), value: ix.genres[g].tracks.length }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 15), 'songs');
		bars(cols, 'Moods', T.MOODS.map(function (m) { return { name: m[1], href: link('c', 'mood', m[0]), value: ix.moods[m[0]] ? ix.moods[m[0]].tracks.length : 0 }; }), 'songs');
		bars(cols, 'Scenes', T.SCENES.map(function (sc) { return { name: sc[1], href: link('c', 'scene', sc[0]), value: ix.scenes[sc[0]] ? ix.scenes[sc[0]].tracks.length : 0 }; }).sort(function (a, b) { return b.value - a.value; }), 'songs');
		bars(cols, 'Languages', T.LANGS.map(function (l) { return { name: l[1], href: link('c', 'lang', l[0]), value: ix.langs[l[0]] ? ix.langs[l[0]].tracks.length : 0 }; }).sort(function (a, b) { return b.value - a.value; }), 'songs');
		bars(cols, 'Added per year', Object.keys(ix.addedY).sort().map(function (y) { return { name: y, href: link('c', 'added', y), value: ix.addedY[y].tracks.length }; }), 'songs, by when you first added them');
		bars(cols, 'Decades', Object.keys(ix.decades).sort().map(function (dk) { return { name: dk, href: link('c', 'decade', dk), value: ix.decades[dk].tracks.length }; }), 'release year where known, else upload year');
		bars(cols, 'Most songs', Object.keys(ix.artists).map(function (k) { var a = ix.artists[k]; return { name: a.name, href: link('artist', k), value: a.tracks.length }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12), 'by artist');
		bars(cols, 'Most played artists', Object.keys(ix.artists).map(function (k) { var a = ix.artists[k]; return { name: a.name, href: link('artist', k), value: a.plays }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12), 'plays counted here');
		bars(cols, 'Plays per song', s.playsHistogram.map(function (b) { return { name: b.label + (b.label === '1' ? ' play' : ' plays'), value: b.count }; }), 'how many songs were played how often; an even shuffle moves them all right together');
		bars(cols, 'Biggest works', Object.keys(ix.works).map(function (w) { return { name: w, href: link('work', w), value: ix.works[w].tracks.length }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12), 'songs');
		if (queueMode === 'true' && bag) view.appendChild(h('p', { class: 'ts-muted', text: 'In this true-shuffle round ' + n(bag.pos) + ' of ' + n(bag.order.length) + ' songs have been drawn; none comes again until all have.' }));
	}

	// ---- Needs attention ---------------------------------------------------------------------------------

	function viewFix(view, parts, query) {
		var ix = idx();
		if (!ix.all.length) { noMusic(view); return; }
		var tab = query.get('tab') || 'unsure';
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Needs attention' }));
		var dups = L.duplicates(lib), dupIds = {};
		dups.forEach(function (g) { g.ids.forEach(function (id) { dupIds[id] = g; }); });
		var TABS_FIX = [
			['unsure', 'No sure artist', ix.all.filter(function (t) { return !t.artistKey; })],
			['unlabelled', 'Not labelled', ix.all.filter(function (t) { return !t.labels && !Object.keys(t.userEdits).length; })],
			['nogenre', 'No genre', ix.all.filter(function (t) { return !t.genres.length; })],
			['dups', 'Duplicates', ix.all.filter(function (t) { return dupIds[t.id]; }).sort(function (a, b) { return cmp(dupIds[a.id].key, dupIds[b.id].key); })],
			['gone', 'Cannot play', ix.all.filter(function (t) { return !L.playable(t); })],
			['blocked', 'Blocked', ix.all.filter(function (t) { return t.blocked; })]
		];
		var bar = h('div', { class: 'ts-chips ts-chipbar', role: 'tablist' });
		TABS_FIX.forEach(function (tb) { var a = h('a', { class: 'ts-chip' + (tab === tb[0] ? ' is-on' : ''), href: '#/fix?tab=' + tb[0], role: 'tab', aria: { selected: tab === tb[0] ? 'true' : 'false' } }, [h('span', { text: tb[1] }), h('span', { class: 'ts-count', text: n(tb[2].length) })]); bar.appendChild(a); });
		view.appendChild(bar);
		var cur = TABS_FIX.filter(function (tb) { return tb[0] === tab; })[0] || TABS_FIX[0];
		var help = {
			unsure: 'Nothing vouches for the artist of these, so the channel stands in its place. One tap on a reading names it; the page then offers to read the channel\'s other guesses the same way.',
			unlabelled: 'No labels file and no correction touch these yet: their genres are YouTube\'s coarse topics. Select several and press Edit to label them together.',
			nogenre: 'Neither labels nor YouTube give these a genre.',
			dups: 'The same song more than once. Nothing is removed; block the copies you do not want to hear.',
			gone: 'Removed, private, or not allowed on other sites. Signing in refreshes them; YouTube decides.',
			blocked: 'No shuffle plays these. Unblock from the menu.'
		};
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: help[cur[0]] }));
		trackList(view, cur[2], {
			context: { label: cur[1], href: '#/fix?tab=' + cur[0] },
			empty: 'Nothing here. Good.',
			extra: cur[0] === 'unsure' ? function (t) {
				var span = h('span', { class: 'ts-guesspicks' });
				guessPicks(t).forEach(function (p) { span.appendChild(h('button', { class: 'ts-pick', text: 'By ' + p[0] + '?', on: { click: function (e) { e.stopPropagation(); acceptGuess(t.id, p[0], p[1]); } } })); });
				return span;
			} : cur[0] === 'dups' ? function (t) { return h('span', { class: 'ts-muted', text: ' ' + DOT + ' ' + t.channel }); } : cur[0] === 'gone' ? function (t) { return h('span', { class: 'ts-muted', text: ' ' + DOT + ' ' + goneWhy(t) }); } : null
		});
	}
	function goneWhy(t) {
		if (t.removed) return t.removedReason === 'gone' ? 'gone from YouTube' : 'removed or private';
		if (t.embeddable === false) return 'cannot be embedded';
		if (t.playerError) return 'player error ' + t.playerError.code;
		return '';
	}

	// ---- Settings ------------------------------------------------------------------------------------------

	function panel(view, title, id) { var s = h('section', { class: 'ts-panel', id: id }); s.appendChild(h('h2', { text: title })); view.appendChild(s); return s; }
	function viewSettings(view) {
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Settings' }));
		// account and import
		var acct = panel(view, 'YouTube', 'set-account');
		if (demo) {
			acct.appendChild(h('p', { text: 'This is the demo: signing in, importing and files are switched off, and nothing you do is kept. ' }, h('a', { href: './', text: 'Leave the demo' })));
		} else {
			var signed = auth.signedIn(), configured = auth.configured();
			if (!configured) {
				var setup = h('div', { class: 'ts-setup' });
				setup.appendChild(h('p', null, [h('b', { text: 'Signing in is not set up yet. ' }), 'The page needs the client id of a Google Cloud project that the person running it creates once. It is not a secret and there is no client secret.']));
				var ol = h('ol');
				['At console.cloud.google.com, signed in with the account whose playlists you want to read, create a project and select it.', 'APIs & Services > Library: enable YouTube Data API v3.', 'OAuth consent screen (Google Auth Platform): audience External, publishing status Testing, yourself under Test users, and the scope https://www.googleapis.com/auth/youtube.readonly; add https://www.googleapis.com/auth/youtube too if you want to add songs to your playlists from here.', 'Credentials > Create credentials > OAuth client ID, type Web application. Authorised JavaScript origin: ' + location.origin + '. Authorised redirect URI: ' + auth.redirectUri() + ' (exactly, with the final slash).', 'Copy the Client ID (it ends in .apps.googleusercontent.com) and paste it below. Ignore the client secret.', 'At the first sign-in Google says it has not verified the app. That only means the project is in Testing; the test users you listed can press Continue.'].forEach(function (s) { ol.appendChild(h('li', { text: s })); });
				setup.appendChild(ol);
				acct.appendChild(setup);
			}
			var cf = h('form', { class: 'ts-inline-form' });
			var cid = h('input', { class: 'kit-input', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '1234-abc.apps.googleusercontent.com', aria: { label: 'Client id for this browser only' } });
			cid.value = ToyKit.load('clientId', '') || '';
			cf.appendChild(h('label', { class: 'ts-muted', text: 'Client id (this browser only)' }));
			cf.appendChild(cid);
			cf.appendChild(h('button', { class: 'kit-btn small', type: 'submit', text: 'Use' }));
			cf.addEventListener('submit', function (e) {
				e.preventDefault();
				var v = cid.value.trim();
				if (v && !/\.apps\.googleusercontent\.com$/.test(v)) { ToyKit.toast('A client id ends in .apps.googleusercontent.com.'); return; }
				ToyKit.store('clientId', v || null);
				auth.setClientId(v || TS.config.clientId);
				renderView(true);
				say(v ? 'This browser now signs in with that client id.' : 'Back to the client id in config.js.');
			});
			acct.appendChild(cf);
			var row = h('div', { class: 'ts-row-btns' });
			if (!signed) { var si = h('button', { class: 'kit-btn primary', text: 'Sign in with Google', disabled: !configured, on: { click: signIn } }); row.appendChild(si); }
			else row.appendChild(h('button', { class: 'kit-btn', text: 'Disconnect', on: { click: signOut } }));
			row.appendChild(h('span', { class: 'ts-muted', text: signed ? 'Signed in' + (sources && sources.me ? ' as ' + sources.me.title : '') + (auth.canWrite() ? ', may add songs to your playlists,' : ', read-only,') + ' for about ' + Math.max(1, Math.round(auth.secondsLeft() / 60)) + ' more minutes.' : 'Read-only access to your YouTube account for one hour. The page cannot change anything there.' }));
			acct.appendChild(row);
			if (signed) {
				acct.appendChild(h('h3', { text: 'Choose what to import' }));
				var ul = h('ul', { class: 'ts-sources' });
				if (!sources) ul.appendChild(h('li', null, [h('button', { class: 'kit-btn', text: 'List my playlists', on: { click: listSources } }), h('span', { class: 'ts-muted', text: ' 3 quota units' })]));
				else sources.sources.forEach(function (s) {
					var cb = h('input', { type: 'checkbox', checked: !!s.ticked, data: { playlist: s.id } });
					cb.addEventListener('change', function () { s.ticked = cb.checked; });
					var info = [];
					if (s.count != null) info.push(plural(s.count, 'video'));
					if (s.privacy) info.push(s.privacy);
					if (lib.playlists[s.id]) info.push('imported');
					if (s.pending) info.push('interrupted: goes on where it stopped');
					ul.appendChild(h('li', null, h('label', { class: 'ts-check' }, [cb, h('span', null, [h('b', { text: s.title || s.id }), h('span', { class: 'ts-muted', text: ' ' + info.join(' ' + DOT + ' ') })])])));
				});
				acct.appendChild(ul);
				var ir = h('div', { class: 'ts-row-btns' });
				ir.appendChild(h('button', { class: 'kit-btn primary', id: 'btn-import', text: 'Import the ticked lists', disabled: !!importing || !sources, on: { click: importTicked } }));
				ir.appendChild(h('button', { class: 'kit-btn', text: 'Refresh everything from YouTube', disabled: !!importing || !L.list(lib).length, on: { click: function () { refreshAll(true); } } }));
				if (importing) ir.appendChild(h('button', { class: 'kit-btn', text: 'Stop', on: { click: function () { if (importing && importing.ctrl) importing.ctrl.abort(); } } }));
				acct.appendChild(ir);
			}
			acct.appendChild(h('div', { class: 'ts-progress', id: 'import-box', hidden: !importing }, [h('progress', { id: 'import-progress', max: '1', value: '0', aria: { label: 'Import progress' } }), h('p', { id: 'import-text', aria: { live: 'polite' } })]));
			acct.appendChild(h('p', { class: 'ts-muted', id: 'quota' }));
			var pls = Object.keys(lib.playlists).map(function (k) { return lib.playlists[k]; });
			if (pls.length) {
				acct.appendChild(h('h3', { text: 'In the library' }));
				var hv = h('ul', { class: 'ts-sources' }), counts = {};
				L.list(lib).forEach(function (t) { t.playlists.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; }); });
				pls.forEach(function (p) {
					hv.appendChild(h('li', null, [h('b', { text: p.title || p.id }), h('span', { class: 'ts-muted', text: ' ' + plural(counts[p.id] || 0, 'track') + (p.refreshedAt ? ' ' + DOT + ' read ' + String(p.refreshedAt).slice(0, 10) : '') + ' ' }), h('button', { class: 'kit-btn small', text: 'Remove', on: { click: function () { removePlaylist(p); } } })]));
				});
				acct.appendChild(hv);
			}
			renderQuota();
		}

		// labels
		var lab = panel(view, 'Labels', 'set-labels');
		var labelled = L.list(lib).filter(function (t) { return t.labels; }).length, edited = L.list(lib).filter(function (t) { return Object.keys(t.userEdits).length; }).length;
		lab.appendChild(h('p', { text: 'Labels are a hand-made reading of the library: artist, title, genres from the families under Genres, mood, scene, the work a song is from and its role there, language and kind. ' + (L.list(lib).length ? n(labelled) + ' of ' + n(L.list(lib).length) + ' tracks carry labels; ' + n(edited) + ' carry your own corrections, which always win.' : '') }));
		lab.appendChild(h('p', { class: 'ts-muted', text: 'A labels file applies a whole set at once and can be applied again after a new import. Artists in it pass their genres, scene and language on to songs imported later.' }));
		if (siteLabels) lab.appendChild(h('p', { class: 'ts-muted', text: 'This site has labels for ' + plural(siteLabels.matched, 'song') + ' of this library (made ' + siteLabels.createdAt.slice(0, 10) + '). They are applied on their own, to songs imported later too; your corrections still win.' }));
		var lr = h('div', { class: 'ts-row-btns' });
		var lfile = h('input', { class: 'kit-sr', type: 'file', id: 'labels-file', accept: 'application/json,.json' });
		lfile.addEventListener('change', function () { var f = lfile.files[0]; if (f) applyLabelsFile(f); lfile.value = ''; });
		lr.appendChild(lfile);
		lr.appendChild(h('label', { class: 'kit-btn primary', for: 'labels-file' }, [icon('upload'), ' Apply a labels file']));
		lr.appendChild(h('button', { class: 'kit-btn', disabled: !labelled && !edited, on: { click: exportLabelsFile } }, [icon('download'), ' Save the labels as a file']));
		lab.appendChild(lr);
		lab.appendChild(h('div', { class: 'ts-row-btns' }, [h('a', { class: 'kit-btn', href: '#/label', text: 'Open the quick labeller' }), h('span', { class: 'ts-muted', text: plural(L.list(lib).filter(needsLabel).length, 'song') + ' without labels' })]));
		var sy = panel(view, 'Sync between devices', 'set-sync');
		sy.appendChild(h('p', { text: 'Your own data (labels, corrections, ratings, plays, playlists and history, never YouTube\'s video data) is kept ready for the Desk. On the Desk, the Music view pushes it to your private repository or pulls it from there; True Shuffle merges what was pulled the next time it opens or gets the focus: ratings by time, plays as the larger count, labels applied, playlists added.' }));
		sy.appendChild(h('div', { class: 'ts-row-btns' }, [h('a', { class: 'kit-btn', href: '../../desk/#/music', text: 'Open the Desk' }), h('button', { class: 'kit-btn', text: 'Check for pulled data now', on: { click: function () { checkInbox(); } } })]));

		// backup
		var bk = panel(view, 'Backup', 'set-backup');
		bk.appendChild(h('p', { class: 'ts-muted', id: 'usage', text: '' }));
		var br = h('div', { class: 'ts-row-btns' });
		br.appendChild(h('button', { class: 'kit-btn', disabled: demo, on: { click: exportAll } }, [icon('download'), ' Export everything']));
		var ifile = h('input', { class: 'kit-sr', type: 'file', id: 'import-file', accept: 'application/json,.json', disabled: demo });
		ifile.addEventListener('change', function () { var f = ifile.files[0]; if (f) importFile(f); ifile.value = ''; });
		br.appendChild(ifile);
		br.appendChild(h('label', { class: 'kit-btn', for: 'import-file' }, [icon('upload'), ' Restore from a file']));
		bk.appendChild(br);
		bk.appendChild(h('p', { class: 'ts-muted', text: 'Restoring replaces everything stored here with the file: library, labels, ratings, plays, queue and stations.' }));
		store.usage().then(function (u) {
			var e = $('usage');
			if (e) e.textContent = 'Stored in this browser' + (store.kind === 'memory' ? ' (in memory only: ' + (store.reason || 'nothing will be kept') + ')' : '') + ': ' + plural(u.tracks, 'track') + ', ' + plural(u.playlists, 'playlist') + ', ' + plural(u.history, 'listen') + (u.bytes ? ', about ' + Math.max(1, Math.round(u.bytes / 1024)) + ' KB' : '') + '.';
		}).catch(function () { /* stays empty */ });

		// appearance
		var ap = panel(view, 'Appearance', 'set-look');
		var artLab = h('label', { class: 'ts-check' });
		var artCb = h('input', { type: 'checkbox', checked: prefs.art });
		artCb.addEventListener('change', function () { prefs.art = artCb.checked; ToyKit.store('art', prefs.art); dirty(); renderBar(); renderQueue(); renderNowInfo(); say(prefs.art ? 'Cover art on.' : 'Cover art off.'); });
		artLab.appendChild(artCb);
		artLab.appendChild(h('span', { text: 'Show cover art: the videos\' thumbnails, loaded from YouTube\'s image server (i.ytimg.com). Off: coloured squares from the genre.' }));
		ap.appendChild(artLab);
		var dens = h('div', { class: 'ts-field' }, [h('span', { text: 'Song lists' })]);
		var seg = h('div', { class: 'ts-seg', role: 'radiogroup', aria: { label: 'Song list density' } });
		[['comfortable', 'Comfortable'], ['compact', 'Compact']].forEach(function (o2) { var b = h('button', { class: 'ts-seg-b', role: 'radio', aria: { checked: prefs.density === o2[0] ? 'true' : 'false' }, text: o2[1], on: { click: function () { prefs.density = o2[0]; ToyKit.store('density', o2[0]); applyDensity(); renderView(true); } } }); seg.appendChild(b); });
		dens.appendChild(seg);
		ap.appendChild(dens);
		ap.appendChild(h('p', { class: 'ts-muted', text: 'Everything bigger or smaller: your browser\u2019s zoom (Ctrl and + or -) scales this page, and the layout follows. The player\u2019s size is under the video: S, M, L, theater and full screen.' }));

		// MusicBrainz
		var mbp = panel(view, 'MusicBrainz', 'set-mb');
		mbp.appendChild(h('p', { class: 'ts-muted', text: 'Optional: genres per artist from musicbrainz.org, for artists your labels do not cover. Sends your artists\' names there, one a second. Genre data under CC BY-NC-SA 3.0.' }));
		var mr = h('div', { class: 'ts-row-btns' });
		mr.appendChild(h('button', { class: 'kit-btn', text: 'Look up genres on MusicBrainz', disabled: !!mbJob || !L.list(lib).length || demo, on: { click: startMB } }));
		if (mbJob) mr.appendChild(h('button', { class: 'kit-btn', text: 'Stop', on: { click: function () { if (mbJob && mbJob.ctrl) mbJob.ctrl.abort(); } } }));
		mr.appendChild(h('span', { class: 'ts-muted', id: 'mb-text', aria: { live: 'polite' } }));
		mbp.appendChild(mr);

		// privacy
		var pv = panel(view, 'Data and privacy', 'set-privacy');
		pv.appendChild(h('p', { text: 'Everything stays in this browser (IndexedDB): the videos of the lists you imported, with the titles, channels, lengths and topics YouTube reports; your labels, corrections, ratings and blocks; play counts, history, the queue and stations. The sign-in token stays in this tab for at most an hour and is revoked by Disconnect. Nothing is sent to this site, and nothing to anyone but Google (cover art from YouTube\'s image server; artist names to MusicBrainz only if you press that button). YouTube data older than 30 days is refreshed at your next sign-in.' }));
		pv.appendChild(h('p', null, ['This page uses YouTube API Services. ', h('a', { href: 'https://www.youtube.com/t/terms', rel: 'noopener', text: 'YouTube Terms of Service' }), ' ' + DOT + ' ', h('a', { href: 'https://policies.google.com/privacy', rel: 'noopener', text: 'Google Privacy Policy' }), ' ' + DOT + ' ', h('a', { href: 'https://myaccount.google.com/permissions', rel: 'noopener', text: 'Remove access at Google' })]));
		var wipeBtn = h('button', { class: 'kit-btn ts-danger', text: 'Delete everything stored here', disabled: demo });
		wipeBtn.addEventListener('click', function () {
			var d = U.openDialog({ title: 'Delete everything?' });
			d.body.appendChild(h('p', { text: 'Delete the library, labels, corrections, ratings, history, queue and stations from this browser? Export first if you may want them back.' }));
			var no = h('button', { class: 'kit-btn', text: 'Keep it', on: { click: d.close } });
			d.body.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'kit-btn ts-danger', text: 'Yes, delete it all', on: { click: function () { d.close(); wipe(); } } }), no]));
			no.focus();
		});
		pv.appendChild(wipeBtn);
	}

	// ---- Settings plumbing ----------------------------------------------------------------------------------

	function renderQuota() {
		var e = $('quota');
		if (!e) return;
		var units = quota && quota.day === Y.pacificDay(Date.now()) ? quota.units : 0;
		e.textContent = demo ? '' : 'YouTube quota used today: ' + n(units) + ' of ' + n(TS.config.dailyQuota) + ' units.';
	}
	function renderStale() {
		var s = L.list(lib).length && !demo ? L.stats(lib, now()) : null;
		var show = !!(s && s.staleCount && !auth.signedIn());
		$('stale').hidden = !show;
		if (show) $('stale-text').textContent = plural(s.staleCount, 'track') + ' carry YouTube details more than 30 days old. YouTube\'s terms ask for them to be refreshed or deleted: sign in and they are refreshed, or delete them under Settings.';
	}
	function signIn() {
		if (demo) return;
		if (!auth.configured()) { location.hash = '#/settings'; say('Signing in needs a Google client id: see Settings.'); return; }
		setStatus('Going to Google to sign in' + ELL);
		auth.signIn().catch(fail);
	}
	function signOut() {
		auth.signOut().then(function (r) {
			sources = null;
			say(r.revoked === true ? 'Disconnected: the access was revoked at Google.' : r.revoked === 'sent' ? 'Disconnected: the revocation was sent to Google.' : 'Disconnected here. Google could not be reached; the access ends by itself within the hour.');
			renderView(true);
		});
	}
	function listSources() {
		setStatus('Asking YouTube for your playlists' + ELL);
		return client.sources().then(function (r) {
			sources = r;
			return Promise.all(r.sources.map(function (s) { return Y.pendingImport(store, s.id).then(function (p) { s.pending = !!p; if (p || lib.playlists[s.id]) s.ticked = true; }); }));
		}).then(function () {
			say(plural(sources.sources.length, 'list') + ' to choose from: tick some and press Import.');
			if (route.parts[0] === 'settings') renderView(true);
		}).catch(onApiError);
	}
	function onApiError(err) {
		if (err && err.code === 'signed-out') { auth.forget(); if (route.parts[0] === 'settings') renderView(true); }
		fail(err);
	}
	function progress(text, value, max) {
		var box = $('import-box');
		if (!box) return;
		box.hidden = false;
		$('import-progress').max = max || 1;
		$('import-progress').value = value || 0;
		$('import-text').textContent = text;
	}
	function importTicked() {
		var picks = (sources ? sources.sources : []).filter(function (s) { return s.ticked; });
		if (!picks.length) { ToyKit.toast('Tick at least one list first.'); return; }
		var ctrl = window.AbortController ? new AbortController() : null;
		importing = { ctrl: ctrl };
		renderView(true);
		var results = [], chain = Promise.resolve();
		picks.forEach(function (s, i) {
			chain = chain.then(function () {
				return Y.importInto({
					client: client, lib: lib, store: store, playlist: s, signal: ctrl ? ctrl.signal : undefined,
					onProgress: function (pr) {
						var txt = pr.phase === 'list' ? 'listed ' + n(pr.listed) + ' of ' + n(pr.total || 0) : pr.phase === 'details' ? 'details ' + n(pr.detailed) + ' of ' + n(pr.toDetail || 0) + ' batches' : 'done';
						progress((i + 1) + ' of ' + picks.length + ': ' + q(s.title) + ', ' + txt + ', ' + plural(pr.quota, 'quota unit') + '.', pr.phase === 'list' ? pr.listed : pr.phase === 'details' ? pr.detailed : 1, pr.phase === 'list' ? pr.total : pr.phase === 'details' ? pr.toDetail : 1);
					}
				}).then(function (r) {
					s.pending = false;
					results.push(r);
					say('Imported ' + q(r.title) + ': ' + n(r.unique) + ' videos, ' + n(r.added.length) + ' new, ' + n(r.missing.length) + ' no longer available.');
					return afterLibraryChange();
				});
			});
		});
		return chain.catch(function (err) {
			if (err && err.code === 'aborted') say('Stopped. What was read is kept; Import goes on from there.');
			else onApiError(err);
		}).then(function () { importing = null; if (route.parts[0] === 'settings') renderView(true); });
	}
	function refreshAll(all) {
		if (importing) return Promise.resolve();
		var ctrl = window.AbortController ? new AbortController() : null;
		importing = { ctrl: ctrl };
		if (route.parts[0] === 'settings') renderView(true);
		return Y.refreshInto({
			client: client, lib: lib, store: store, all: !!all, signal: ctrl ? ctrl.signal : undefined, olderThanDays: TS.config.refreshDays,
			onProgress: function (pr) { progress('Refreshing: ' + n(pr.done) + ' of ' + n(pr.total) + ', ' + plural(pr.quota, 'quota unit') + '.', pr.done, pr.total); }
		}).then(function (r) {
			say('Refreshed ' + plural(r.checked, 'track') + ': ' + n(r.removed.length) + ' gone since, ' + n(r.restored.length) + ' back.');
			return saveMeta();
		}).catch(onApiError).then(function () { importing = null; return afterLibraryChange(); });
	}
	function removePlaylist(p) {
		var r = L.removePlaylist(lib, p.id, { dropOrphans: true });
		Promise.all([store.deletePlaylists([p.id]), store.deleteTracks(r.deleted), saveIds(r.changed), saveMeta()]).then(function () {
			say('Removed ' + q(p.title) + ': ' + plural(r.deleted.length, 'track') + ' deleted; tracks you played, rated, labelled or that are in another playlist stay.');
			return afterLibraryChange();
		}).catch(fail);
	}
	function afterLibraryChange() {
		dirty();
		var p = queueMode === 'true' ? ensureBag() : Promise.resolve();
		return p.then(function () {
			var st = ctl.state();
			if (!st.items.length && L.list(lib).length) return applyPlan({});
		}).then(function () { renderAll(); return applySiteLabels(); }).catch(fail);
	}
	function startMB() {
		var ctrl = window.AbortController ? new AbortController() : null;
		var mb = Y.createMusicBrainz({ endpoints: ep });
		var artists = L.facets(lib, L.list(lib), now()).artist.filter(function (a) { return a.key && !a.guess && !lib.genres.artist[a.key]; });
		mbJob = { ctrl: ctrl };
		renderView(true);
		mb.genresForArtists(artists, {
			lib: lib, signal: ctrl ? ctrl.signal : undefined,
			onProgress: function (p) { var e = $('mb-text'); if (e) e.textContent = n(p.done) + ' of ' + n(p.total) + ' artists (' + n(p.found || 0) + ' found)' + (p.name ? ': ' + p.name : ''); }
		}).then(function (r) {
			say('MusicBrainz knew genres for ' + plural(r.found, 'artist') + '.');
			return changed(r.changed, true);
		}).catch(function (err) {
			say(err && err.code === 'aborted' ? 'Stopped. Genres found so far are kept.' : (err.message || String(err)));
			return saveMeta();
		}).then(function () { mbJob = null; if (route.parts[0] === 'settings') renderView(true); });
	}
	function readJson(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { try { resolve(JSON.parse(String(reader.result))); } catch (e) { reject(new Error('That file is not JSON, so nothing was changed.')); } };
			reader.onerror = function () { reject(new Error('The file could not be read.')); };
			reader.readAsText(file);
		});
	}
	// Apply a checked labels object: store every track and the meta, then redraw.
	function applyLabelsData(data) {
		var res = L.applyLabels(lib, data);
		return saveIds(Object.keys(lib.tracks)).then(saveMeta).then(function () {
			if (data.createdAt) kvSet('labels:applied', String(data.createdAt));
			dirty();
			if (queueMode === 'true' && bag) return ensureBag();
		}).then(function () { renderAll(); return res; });
	}
	function applyLabelsFile(file) {
		readJson(file).then(function (data) {
			var why = L.checkLabels(data);
			if (why) throw new Error(why);
			setStatus('Applying the labels' + ELL);
			return applyLabelsData(data).then(function (res) {
				say('Labels applied to ' + plural(res.matched, 'track') + (res.missing ? '; ' + n(res.missing) + ' in the file are not in this library' : '') + '. ' + plural(res.artists, 'artist profile') + ' kept for later imports.');
			});
		}).catch(fail);
	}
	// The owner's labels ship with the site (labels.json next to the page). They apply only to a
	// library that is mostly in them, once per version of the file, and to songs imported since.
	// Corrections made here still win over them.
	var siteLabels = null;
	function applySiteLabels() {
		if (thumb || demo || !store || !L.list(lib).length || !window.fetch) return Promise.resolve();
		return fetch('labels.json', { cache: 'no-cache' }).then(function (r) {
			if (!r.ok) throw new Error('no site labels');
			return r.json();
		}).then(function (data) {
			if (L.checkLabels(data)) return;
			var ids = Object.keys(lib.tracks), inFile = ids.filter(function (id) { return data.tracks[id]; });
			if (inFile.length < Math.max(50, ids.length / 2)) return;
			siteLabels = { createdAt: String(data.createdAt || ''), matched: inFile.length };
			return kvGet('labels:applied', '').then(function (last) {
				if (!last || siteLabels.createdAt > String(last)) {
					return applyLabelsData(data).then(function (res) { say('Labels for ' + plural(res.matched, 'song') + ' loaded from the site.'); });
				}
				var missing = inFile.filter(function (id) { return !lib.tracks[id].labels; });
				if (!missing.length) return;
				var part = { format: data.format, version: data.version, tracks: {} };
				missing.forEach(function (id) { part.tracks[id] = data.tracks[id]; });
				return applyLabelsData(part).then(function () { say('Labels for ' + plural(missing.length, 'new song') + ' loaded from the site.'); });
			});
		}).catch(function () { /* no labels on this site, or offline: nothing to apply */ });
	}
	function exportLabelsFile() {
		var data = L.exportLabels(lib, Date.now());
		ToyKit.download('true-shuffle-labels-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 1), 'application/json');
		say('Saved the labels of ' + plural(Object.keys(data.tracks).length, 'track') + '.');
	}
	function exportAll() {
		store.exportAll(Date.now()).then(function (data) {
			ToyKit.download('true-shuffle-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
			say('Exported ' + plural(data.tracks.length, 'track') + ', ' + plural(data.history.length, 'listen') + ' and your settings as one file.');
		}).catch(fail);
	}
	function importFile(file) {
		readJson(file).then(function (data) {
			if (data && data.format === L.LABELS_FORMAT) { applyLabelsFile(file); return; }
			return store.importAll(data, { mode: 'replace' }).then(reloadFromStore).then(function () {
				say('Restored the file: ' + plural(L.list(lib).length, 'track') + '.');
			});
		}).catch(fail);
	}
	function reloadFromStore() {
		if (ctl) { ctl.destroy(); ctl = null; }
		player.stop();
		return store.loadLibrary().then(function (parts) {
			lib = L.fromParts(parts);
			bag = null; bagKey = '';
			dirty();
			return Promise.all([loadSettings(), loadHistory()]);
		}).then(startQueue).then(renderAll);
	}
	function wipe() {
		if (ctl) ctl.destroy();
		player.stop();
		store.wipe().then(function () {
			ToyKit.store('clientId', null);
			auth.setClientId(TS.config.clientId);
			lib = L.create();
			bag = null; bagKey = ''; stations = []; lists = []; focus = null; histCache = []; quota = null;
			plan = copyPlan(DEFAULT_PLAN);
			context = { label: 'Your library', href: '#/songs', patch: {} };
			ctl = null;
			dirty();
			makeController(S.queueInit());
			renderAll();
			say('Everything stored here was deleted. To also remove this page\'s access to your YouTube account, press Disconnect or visit myaccount.google.com/permissions.');
		}).catch(fail);
	}

	// ---- Playlists and focus -------------------------------------------------------------------------------
	// A playlist is smart (a saved filter: { patch, mode }) or hand-picked ({ ids }).
	// Focus narrows the whole app to one playlist until it is cleared.

	var lists = [], focus = null, scopeMemo = null;
	function newId() { return 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
	function listById(id) { for (var i = 0; i < lists.length; i++) if (lists[i].id === id) return lists[i]; return null; }
	function saveLists() { if (!thumb) store.set('lists', lists); queueSync(); renderNav(); }
	function scopeSelect(patch) { var s = selectOf(planWith(patch || {}, 'true')); s.includeBlocked = true; s.includeUnplayable = true; return s; }
	function listTracks(li) {
		if (!li) return [];
		if (li.kind === 'manual') return (li.ids || []).map(function (id) { return lib.tracks[id]; }).filter(Boolean);
		return S.select(L.list(lib), scopeSelect(li.patch), now());
	}
	// The tracks the app works with: the focused playlist's, or all.
	function scopeTracks() {
		if (!focus) return L.list(lib);
		if (scopeMemo) return scopeMemo;
		var li = listById(focus);
		if (!li) { focus = null; return L.list(lib); }
		return (scopeMemo = listTracks(li));
	}
	function setFocus(id, quiet) {
		focus = id || null;
		scopeMemo = null;
		dirty();
		if (!thumb) store.set('focus', focus);
		if (queueMode === 'true' && ctl && ctl.current() != null) applyPlan({});
		else { bag = null; bagKey = ''; }
		renderAll();
		renderFocusBtn();
		if (!quiet) say(focus ? 'Focused on ' + q(listById(focus).name) + ': the whole app works inside it.' : 'Back to everything.');
	}
	function renderFocusBtn() {
		var b = $('focus-btn');
		if (!b) return;
		var li = focus && listById(focus);
		clear(b);
		b.appendChild(icon(li ? 'mix' : 'songs'));
		b.appendChild(h('span', { class: 'ts-focus-label', text: li ? li.name : 'Everything' }));
		b.appendChild(icon('down', 'ts-focus-caret'));
		b.classList.toggle('is-on', !!li);
		b.setAttribute('aria-label', 'Working in: ' + (li ? li.name : 'everything') + '. Change');
	}
	function focusMenu(anchor) {
		var items = [{ heading: 'Work inside' }, { label: 'Everything', icon: 'songs', checked: !focus, onSelect: function () { setFocus(null); } }];
		lists.forEach(function (li) { items.push({ label: li.name, icon: li.kind === 'manual' ? 'list' : 'mix', hint: n(listTracks(li).length), checked: focus === li.id, onSelect: function () { setFocus(li.id); } }); });
		items.push({ sep: true });
		items.push({ label: 'Suggested and all playlists' + ELL, icon: 'genre', onSelect: function () { location.hash = '#/lists'; } });
		items.push({ label: 'New smart playlist' + ELL, icon: 'plus', onSelect: function () { draft = copyPlan(DEFAULT_PLAN); editingList = null; location.hash = '#/mix'; } });
		U.openMenu(anchor, items, { label: 'Focus', focusChecked: true });
	}
	// Ask for a name, create the playlist, optionally focus it.
	function createList(kind, data, suggested, opts) {
		opts = opts || {};
		var d = U.openDialog({ title: kind === 'manual' ? 'New playlist' : 'Save as a playlist' });
		var f = h('form', { class: 'ts-edit' });
		var inp = h('input', { class: 'kit-input', type: 'text', aria: { label: 'Playlist name' } });
		inp.value = suggested || '';
		f.appendChild(h('label', { class: 'ts-field' }, [h('span', { text: 'Name' }), inp]));
		var count = kind === 'manual' ? (data.ids || []).length : S.select(L.list(lib), scopeSelect(data.patch), now()).length;
		f.appendChild(h('p', { class: 'ts-muted', text: kind === 'manual' ? plural(count, 'song') + ' to start with. Add more from any song\'s menu.' : plural(count, 'song') + ' now. A smart playlist follows its filter: songs you label later join it by themselves.' }));
		var fl = h('label', { class: 'ts-check' }, [h('input', { type: 'checkbox', checked: opts.focus !== false }), h('span', { text: 'Focus on it now (the whole app works inside it)' })]);
		f.appendChild(fl);
		f.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'kit-btn primary', type: 'submit', text: 'Create' }), h('button', { class: 'kit-btn', text: 'Cancel', on: { click: d.close } })]));
		f.addEventListener('submit', function (e) {
			e.preventDefault();
			var name = inp.value.trim();
			if (!name) { inp.focus(); return; }
			var li = { id: newId(), name: name, kind: kind, created: new Date().toISOString() };
			if (kind === 'manual') li.ids = (data.ids || []).slice(); else { li.patch = data.patch || {}; if (data.mode) li.mode = data.mode; }
			lists.push(li);
			saveLists();
			d.close();
			if (fl.querySelector('input').checked) setFocus(li.id, true);
			if (opts.go !== false) location.hash = link('list', li.id);
			say('Created ' + q(name) + '.');
			if (opts.done) opts.done(li);
		});
		d.body.appendChild(f);
		inp.focus();
		inp.select();
	}
	function addToList(ids, at) {
		var manual = lists.filter(function (li) { return li.kind === 'manual'; });
		var items = [{ heading: 'Add ' + (ids.length === 1 ? 'this song' : plural(ids.length, 'song')) + ' to' }];
		manual.forEach(function (li) {
			items.push({ label: li.name, icon: 'list', hint: n(li.ids.length), onSelect: function () {
				var added = 0;
				ids.forEach(function (id) { if (li.ids.indexOf(id) < 0) { li.ids.push(id); added++; } });
				li.updated = new Date().toISOString();
				saveLists();
				if (focus === li.id) { scopeMemo = null; dirty(); }
				say(added ? plural(added, 'song') + ' added to ' + q(li.name) + '.' : 'Already in ' + q(li.name) + '.');
			} });
		});
		items.push({ sep: true });
		items.push({ label: 'New playlist' + ELL, icon: 'plus', onSelect: function () { createList('manual', { ids: ids }, '', { focus: false }); } });
		U.openMenu(at, items, { label: 'Add to playlist' });
	}
	function removeFromList(li, ids) {
		li.ids = li.ids.filter(function (id) { return ids.indexOf(id) < 0; });
		saveLists();
		scopeMemo = null; dirty();
		renderView(true);
		var before = ids.slice();
		U.toast(plural(ids.length, 'song') + ' removed from ' + q(li.name) + '.', { action: 'Undo', onAction: function () { before.forEach(function (id) { if (li.ids.indexOf(id) < 0) li.ids.push(id); }); saveLists(); scopeMemo = null; dirty(); renderView(true); } });
	}
	// The buttons a collection page offers for working inside it.
	function scopeButtons(patch, name, ids) {
		var out = [];
		var existing = lists.filter(function (li) { return li.kind === 'smart' && S.signature(li.patch || {}) === S.signature(patch || {}); })[0];
		if (existing) out.push(actionBtn(focus === existing.id ? 'close' : 'mix', focus === existing.id ? 'Leave focus' : 'Focus', function () { setFocus(focus === existing.id ? null : existing.id); }));
		else if (patch) out.push(actionBtn('mix', 'Focus', function () {
			var li = { id: newId(), name: name, kind: 'smart', patch: patch, created: new Date().toISOString(), auto: true };
			lists.push(li); saveLists(); setFocus(li.id);
		}));
		out.push(actionBtn('plus', existing ? 'Saved' : 'Save as playlist', function () {
			if (existing) { location.hash = link('list', existing.id); return; }
			if (patch) createList('smart', { patch: patch }, name, { focus: false, go: false });
			else createList('manual', { ids: ids }, name, { focus: false, go: false });
		}));
		return out;
	}
	// Suggestions drawn from the library: scenes, the biggest works, roles, moods inside scenes.
	function suggestions() {
		var ix = { scenes: {}, works: {}, roles: {}, combos: {} };
		L.list(lib).forEach(function (t) {
			if (t.kind === 'clip') return;
			if (t.scene) ix.scenes[t.scene] = (ix.scenes[t.scene] || 0) + 1;
			if (t.work) ix.works[t.work] = (ix.works[t.work] || 0) + 1;
			if (t.role === 'OP' || t.role === 'ED') ix.roles[t.role] = (ix.roles[t.role] || 0) + 1;
			if (t.scene && t.mood) { var k = t.mood + '|' + t.scene; ix.combos[k] = (ix.combos[k] || 0) + 1; }
		});
		var out = [];
		T.SCENES.forEach(function (s) { if (ix.scenes[s[0]] >= 5) out.push({ name: s[1], patch: { scenes: [s[0]] }, n: ix.scenes[s[0]], hue: { h: SCENE_HUE[s[0]], s: 50 } }); });
		if (ix.roles.OP) out.push({ name: 'Openings', patch: { roles: ['OP'] }, n: ix.roles.OP, hue: { h: 330, s: 55 } });
		if (ix.roles.ED) out.push({ name: 'Endings', patch: { roles: ['ED'] }, n: ix.roles.ED, hue: { h: 280, s: 45 } });
		Object.keys(ix.combos).filter(function (k) { return ix.combos[k] >= 25; }).sort(function (a, b) { return ix.combos[b] - ix.combos[a]; }).slice(0, 6).forEach(function (k) {
			var p = k.split('|');
			out.push({ name: T.MOOD_NAME[p[0]] + ' ' + (T.SCENE_NAME[p[1]] || p[1]).toLowerCase(), patch: { moods: [p[0]], scenes: [p[1]] }, n: ix.combos[k], hue: { h: MOOD_HUE[p[0]], s: 55 } });
		});
		var yc = {};
		L.list(lib).forEach(function (t) { if (t.kind === 'clip') return; var y = S.addedKeys(t)[0]; if (y) yc[y] = (yc[y] || 0) + 1; });
		Object.keys(yc).filter(function (y) { return yc[y] >= 40; }).sort().reverse().forEach(function (y) { out.push({ name: 'Added in ' + y, patch: { added: [y] }, n: yc[y], hue: addedHue(y) }); });
		Object.keys(ix.works).filter(function (w) { return ix.works[w] >= 6; }).sort(function (a, b) { return ix.works[b] - ix.works[a]; }).slice(0, 14).forEach(function (w) { out.push({ name: w, patch: { works: [w] }, n: ix.works[w], hue: { h: 210, s: 40 } }); });
		return out.filter(function (sg) { return !lists.some(function (li) { return li.kind === 'smart' && S.signature(li.patch || {}) === S.signature(sg.patch); }); });
	}
	function viewLists(view) {
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Playlists' }));
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Work with part of your library instead of all of it. A smart playlist is a saved filter (visual novels, one game, wistful anime songs); a hand-picked one holds the songs you add. Focus on either and every page, shuffle, search and the map work inside it.' }));
		var row = h('div', { class: 'ts-row-btns' });
		row.appendChild(actionBtn('plus', 'New smart playlist', function () { draft = copyPlan(DEFAULT_PLAN); editingList = null; location.hash = '#/mix'; }, true));
		row.appendChild(actionBtn('list', 'New hand-picked playlist', function () { createList('manual', { ids: [] }, ''); }));
		if (focus) row.appendChild(actionBtn('close', 'Leave focus', function () { setFocus(null); }));
		view.appendChild(row);
		if (lists.length) {
			sectionHead(view, 'Yours');
			grid(view, lists.map(function (li) {
				var ts = listTracks(li), cov = coverOf(ts);
				var c = card({ href: link('list', li.id), art: cov ? artFor(cov) : U.swatch(200, li.name), title: li.name, sub: (li.kind === 'manual' ? 'Hand-picked' : 'Smart') + ' ' + DOT + ' ' + plural(ts.length, 'song') + (focus === li.id ? ' ' + DOT + ' focused' : ''), play: function () { playList(li, true); }, playLabel: 'Shuffle ' + li.name });
				if (focus === li.id) c.classList.add('is-focused');
				return c;
			}), 'is-cards');
		}
		var sg = suggestions();
		if (sg.length) {
			sectionHead(view, 'Suggested from your library');
			view.appendChild(h('p', { class: 'ts-muted', text: 'One click focuses on it; the plus keeps it as a playlist.' }));
			grid(view, sg.map(function (s) {
				var wrap = tile({ href: '#', title: s.name, sub: plural(s.n, 'song'), hue: s.hue });
				var a = wrap.querySelector('a');
				a.addEventListener('click', function (e) { e.preventDefault(); var li = { id: newId(), name: s.name, kind: 'smart', patch: s.patch, created: new Date().toISOString(), auto: true }; lists.push(li); saveLists(); setFocus(li.id); location.hash = link('list', li.id); });
				wrap.appendChild(h('button', { class: 'ts-bigplay is-plus', aria: { label: 'Save ' + s.name + ' as a playlist' }, title: 'Save as playlist', on: { click: function (e) { e.preventDefault(); createList('smart', { patch: s.patch }, s.name, { focus: false, go: false, done: function () { renderView(true); } }); } } }, icon('plus')));
				return wrap;
			}), 'is-tiles is-small');
		}
	}
	function playList(li, shuffle) {
		var ts = listTracks(li), ctx = { label: li.name, href: link('list', li.id), patch: li.kind === 'smart' ? li.patch : {} };
		if (shuffle && li.kind === 'smart') { shuffleThese(li.patch, ctx, li.mode); return; }
		var ids = ts.map(function (t) { return t.id; });
		if (shuffle) ids = S.spreadShuffle(playable(ts), S.cryptoRng(), {});
		playIds(ids, 0, ctx);
	}
	var editingList = null;
	function viewList(view, parts) {
		var li = listById(parts[0]);
		if (!li) { view.appendChild(h('p', { class: 'ts-empty', text: 'This playlist is gone.' })); return; }
		var ts = listTracks(li), ix = idx();
		var sort = route.query.get('sort') || (li.kind === 'manual' ? 'list' : 'artist');
		var shown = sort === 'list' ? ts : sorted(ts, sort);
		var cov = coverOf(ts);
		var desc = li.kind === 'smart' ? mixWords(planWith(li.patch || {})) || 'Everything.' : 'Hand-picked.';
		var actions = [
			actionBtn('play', 'Play', function () { playIds(shown.map(function (t) { return t.id; }), 0, { label: li.name, href: link('list', li.id), patch: li.kind === 'smart' ? li.patch : {} }); }, true),
			li.kind === 'smart' ? shuffleSplit(li.patch || {}, { label: li.name, href: link('list', li.id), patch: li.patch || {} }) : actionBtn('shuffle', 'Shuffle', function () { playList(li, true); }),
			actionBtn(focus === li.id ? 'close' : 'mix', focus === li.id ? 'Leave focus' : 'Focus', function () { setFocus(focus === li.id ? null : li.id); })
		];
		if (li.kind === 'smart') actions.push(actionBtn('edit', 'Edit filter', function () { draft = planWith(li.patch || {}, li.mode || plan.mode); editingList = li.id; location.hash = '#/mix'; }));
		actions.push(U.iconBtn('more', 'More', { on: { click: function (e) {
			U.openMenu(e.currentTarget, [
				{ label: 'Rename' + ELL, icon: 'edit', onSelect: function () { renameList(li); } },
				{ label: 'Edit every song' + ELL, icon: 'edit', onSelect: function () { openEditor(ts.map(function (t) { return t.id; })); } },
				li.kind === 'smart' ? { label: 'Copy as hand-picked', icon: 'list', onSelect: function () { createList('manual', { ids: ts.map(function (t) { return t.id; }) }, li.name + ' (copy)', { focus: false }); } } : null,
				{ label: 'Delete playlist', icon: 'close', onSelect: function () { lists = lists.filter(function (x) { return x !== li; }); if (focus === li.id) setFocus(null, true); saveLists(); location.hash = '#/lists'; say('Deleted ' + q(li.name) + '.'); } }
			]);
		} } }));
		headerBlock(view, { kicker: (li.kind === 'manual' ? 'Hand-picked playlist' : 'Smart playlist') + (focus === li.id ? ' ' + DOT + ' focused' : ''), title: li.name, blurb: desc, hue: cov ? trackHue(cov) : { h: 200, s: 40 }, artNode: cov ? artFor(cov, 'ts-hero-art') : null, meta: metaLine(ts), actions: actions });
		var hd = h('div', { class: 'ts-sec-head' }, [h('h2', { text: 'Songs' })]);
		var opts = (li.kind === 'manual' ? [['list', 'Your order']] : []).concat(SORT_OPTS);
		hd.appendChild(sortSelect(sort, function (v) { setQuery({ sort: v }); }, opts));
		view.appendChild(hd);
		trackList(view, shown, { context: { label: li.name, href: link('list', li.id), patch: li.kind === 'smart' ? li.patch : {} }, list: li.kind === 'manual' ? li : null, empty: li.kind === 'manual' ? 'Empty. Add songs from any song\'s menu (Add to playlist), or select several and press Add.' : 'Nothing matches this filter yet.' });
		if (li.kind === 'smart' && ix.all.length) view.appendChild(h('p', { class: 'ts-muted', text: 'Songs join and leave by themselves as their labels change.' }));
	}
	function renameList(li) {
		var d = U.openDialog({ title: 'Rename' });
		var f = h('form', { class: 'ts-edit' });
		var inp = h('input', { class: 'kit-input', type: 'text', aria: { label: 'Name' } });
		inp.value = li.name;
		f.appendChild(inp);
		f.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'kit-btn primary', type: 'submit', text: 'Rename' }), h('button', { class: 'kit-btn', text: 'Cancel', on: { click: d.close } })]));
		f.addEventListener('submit', function (e) { e.preventDefault(); if (!inp.value.trim()) return; li.name = inp.value.trim(); delete li.auto; saveLists(); d.close(); renderView(true); renderFocusBtn(); });
		d.body.appendChild(f);
		inp.focus(); inp.select();
	}

	// ---- History -----------------------------------------------------------------------------------------

	var histCache = [];
	function loadHistory() { if (thumb || demo) return Promise.resolve(); return store.getHistory({ limit: 5000 }).then(function (hs) { histCache = hs || []; }).catch(function () { histCache = []; }); }
	function recentIds(days, minPlays) {
		var since = now() - days * 86400000, c = {}, order = [];
		histCache.forEach(function (e) { if (e.kind !== 'play' || e.at < since || !lib.tracks[e.id]) return; if (!c[e.id]) order.push(e.id); c[e.id] = (c[e.id] || 0) + 1; });
		return order.filter(function (id) { return c[id] >= (minPlays || 1); }).sort(function (a, b) { return c[b] - c[a]; });
	}
	function recentlyPlayed(limit) {
		var seen = {}, out = [];
		for (var i = 0; i < histCache.length && out.length < limit; i++) { var id = histCache[i].id; if (!seen[id] && lib.tracks[id]) { seen[id] = true; out.push(id); } }
		return out;
	}
	function viewHistory(view) {
		view.appendChild(h('h1', { class: 'ts-h1', text: 'History' }));
		if (!histCache.length) { view.appendChild(h('p', { class: 'ts-empty', text: demo ? 'The demo keeps no history.' : 'Nothing played yet. Everything you hear (to the end or at least half of it) and every skip is kept here, in this browser.' })); return; }
		var plays = histCache.filter(function (e) { return e.kind === 'play'; }).length;
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: plural(plays, 'play') + ' and ' + plural(histCache.length - plays, 'skip') + ' kept.' }));
		var rep = recentIds(30, 2).slice(0, 18);
		if (rep.length) { sectionHead(view, 'On repeat (last 30 days)'); shelf(view, rep.map(function (id, i) { return trackCard(lib.tracks[id], rep, i, { label: 'On repeat', href: '#/history' }); })); }
		// plays per month, a single-series bar list
		var months = {};
		histCache.forEach(function (e) { if (e.kind === 'play') { var m = new Date(e.at).toISOString().slice(0, 7); months[m] = (months[m] || 0) + 1; } });
		bars(view, 'Plays per month', Object.keys(months).sort().slice(-12).map(function (m) { return { name: m, value: months[m] }; }), 'the last twelve months with plays');
		var byDay = {}, days = [];
		histCache.slice(0, 600).forEach(function (e) {
			if (!lib.tracks[e.id]) return;
			var d = new Date(e.at).toISOString().slice(0, 10);
			if (!byDay[d]) { byDay[d] = []; days.push(d); }
			byDay[d].push(e);
		});
		days.forEach(function (d) {
			sectionHead(view, d === new Date(now()).toISOString().slice(0, 10) ? 'Today' : d);
			var ul = h('ul', { class: 'ts-histlist' });
			byDay[d].forEach(function (e) {
				var t = lib.tracks[e.id];
				var li = h('li', { class: e.kind === 'skip' ? 'is-skip' : '' });
				li.appendChild(h('span', { class: 'ts-hist-time', text: new Date(e.at).toTimeString().slice(0, 5) }));
				var b = h('button', { class: 'ts-q-main', title: 'Play', on: { click: function () { playIds([t.id], 0, { label: 'History', href: '#/history' }); } } });
				b.appendChild(artFor(t, 'ts-q-art'));
				b.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: trackTitle(t) }), h('span', { class: 'ts-q-artist', text: trackArtist(t) + (e.kind === 'skip' ? ' ' + DOT + ' skipped after ' + clock(e.listenedSec) : '') })]));
				li.appendChild(b);
				ul.appendChild(li);
			});
			view.appendChild(ul);
		});
	}

	// ---- The quick labeller ------------------------------------------------------------------------------
	// One song at a time: it can play while the keys set mood (1 to 6) and the
	// suggestions offer genres, scene and work from the channel, the artist and
	// the songs whose names are nearest.

	var labelQueue = null, labelAt = 0;
	function needsLabel(t) { return !t.labels && !Object.keys(t.userEdits).length; }
	function startLabelling(ids) { labelQueue = ids.slice(); labelAt = 0; location.hash = '#/label'; }
	function suggestFor(t) {
		var ck = L.channelKey(t), g = {}, sc = {}, wk = {}, artist = {};
		function vote(map, k, w) { if (k) map[k] = (map[k] || 0) + w; }
		L.list(lib).forEach(function (x) {
			if (x.id === t.id || needsLabel(x)) return;
			var w = 0;
			if (L.channelKey(x) === ck) w += 2;
			if (t.artistKey && x.artistKey === t.artistKey) w += 3;
			if (!w) return;
			x.genres.forEach(function (gg, i) { vote(g, gg, w * (i ? 0.6 : 1)); });
			vote(sc, x.scene, w); vote(wk, x.work, w); vote(artist, x.artist, w);
		});
		// names: songs whose titles share words with this one
		var words = Parse.fold(t.raw.title).split(' ').filter(function (w2) { return w2.length > 2; });
		if (words.length) L.list(lib).forEach(function (x) {
			if (x.id === t.id || needsLabel(x)) return;
			var hay = ' ' + Parse.fold(x.raw.title + ' ' + (x.work || '')) + ' ', hit = 0;
			words.forEach(function (w2) { if (hay.indexOf(' ' + w2 + ' ') >= 0) hit++; });
			if (hit >= 2 || (hit === 1 && words.length <= 2)) { vote(wk, x.work, hit); x.genres.forEach(function (gg) { vote(g, gg, hit * 0.5); }); }
		});
		function top(map, k) { return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, k); }
		return { genres: top(g, 6), scenes: top(sc, 3), works: top(wk, 4), artists: top(artist, 3) };
	}
	function viewLabel(view) {
		if (!labelQueue) { labelQueue = scopeTracks().filter(needsLabel).map(function (t) { return t.id; }); labelAt = 0; }
		var ids = labelQueue;
		while (labelAt < ids.length && !lib.tracks[ids[labelAt]]) labelAt++;
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Quick labeller' }));
		if (!ids.length || labelAt >= ids.length) {
			view.appendChild(h('p', { class: 'ts-empty', text: ids.length ? 'Done: ' + plural(ids.length, 'song') + ' labelled or skipped.' : 'Every song here has labels. Songs you import later land here; you can also select songs anywhere and choose Label them one by one.' }));
			view.appendChild(h('div', { class: 'ts-row-btns' }, [actionBtn('rotate', 'Start over with what is left', function () { labelQueue = null; renderView(false); })]));
			return;
		}
		var t = lib.tracks[ids[labelAt]];
		if (!t) { labelAt++; renderView(true); return; }
		var sg = suggestFor(t);
		var fields = { artist: t.artist || '', title: t.title, genres: t.genres.filter(function (g) { return T.genre(g); }), mood: t.mood || '', scene: t.scene || '', work: t.work || '', role: t.role || '', lang: t.lang || '', kind: t.kind || '' };
		view.appendChild(h('p', { class: 'ts-muted', text: (labelAt + 1) + ' of ' + n(ids.length) + '. Keys: 1 to 6 set the mood, Enter saves and goes on, the right arrow skips, the left arrow goes back, P plays.' }));
		var card2 = h('div', { class: 'ts-labelcard' });
		var head = h('div', { class: 'ts-labelhead' });
		head.appendChild(artFor(t, 'ts-label-art'));
		var tx = h('div');
		tx.appendChild(h('p', { class: 'ts-kicker', text: 'On YouTube' }));
		tx.appendChild(h('h2', { class: 'ts-now-title', text: t.raw.title }));
		tx.appendChild(h('p', { class: 'ts-muted', text: t.channel + (t.durationSec ? ' ' + DOT + ' ' + clock(t.durationSec) : '') }));
		tx.appendChild(h('div', { class: 'ts-row-btns' }, [actionBtn('play', 'Play it', function () { playIds([t.id], 0, { label: 'Labelling', href: '#/label' }); })]));
		head.appendChild(tx);
		card2.appendChild(head);
		var g2 = h('div', { class: 'ts-edit-grid' });
		function text(key, label, list) {
			var lab = h('label', { class: 'ts-field' }, [h('span', { text: label })]);
			var inp = h('input', { class: 'kit-input', type: 'text', value: fields[key], autocomplete: 'off', spellcheck: 'false' });
			inp.addEventListener('input', function () { fields[key] = inp.value; });
			lab.appendChild(inp);
			if (list && list.length) {
				var sug = h('div', { class: 'ts-chips is-tight' });
				list.forEach(function (v) { sug.appendChild(h('button', { class: 'ts-chip is-small', text: v, on: { click: function () { inp.value = v; fields[key] = v; } } })); });
				lab.appendChild(sug);
			}
			g2.appendChild(lab);
			return inp;
		}
		var picks = guessPicks(t).map(function (p) { return p[0]; });
		var first = text('artist', 'Artist', sg.artists.concat(picks).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 4));
		text('title', 'Title');
		text('work', 'From (anime, game, musical)', sg.works);
		function chipsRow(label, key, rows, multi, hueFn) {
			var box = h('div', { class: 'ts-field is-wide' }, [h('span', { text: label })]);
			var row = h('div', { class: 'ts-chips is-tight' });
			rows.forEach(function (r, i) {
				var on = multi ? fields[key].indexOf(r[0]) >= 0 : fields[key] === r[0];
				var b = h('button', { class: 'ts-chip' + (on ? ' is-on' : '') + (hueFn ? ' is-hued' : ''), aria: { pressed: on ? 'true' : 'false' } }, [h('span', { text: (key === 'mood' ? (i + 1) + ' ' : '') + r[1] })]);
				if (hueFn) { var hu = hueFn(r[0]); b.style.setProperty('--h', String(hu.h)); b.style.setProperty('--s', hu.s + '%'); }
				b.addEventListener('click', function () {
					if (multi) { var at = fields[key].indexOf(r[0]); if (at >= 0) fields[key].splice(at, 1); else { if (fields[key].length >= 3) fields[key].pop(); fields[key].push(r[0]); } }
					else fields[key] = fields[key] === r[0] ? '' : r[0];
					redraw();
				});
				row.appendChild(b);
			});
			box.appendChild(row);
			return box;
		}
		var dyn = h('div', { class: 'ts-labeldyn' });
		function redraw() {
			clear(dyn);
			dyn.appendChild(chipsRow('Mood', 'mood', T.MOODS, false, function (k) { return { h: MOOD_HUE[k], s: 60 }; }));
			var gs = sg.genres.slice();
			fields.genres.forEach(function (g) { if (gs.indexOf(g) < 0) gs.push(g); });
			var gbox = chipsRow('Genres (suggested first; up to three)', 'genres', gs.map(function (g) { return [g, g]; }), true, function (k) { return T.hueOf(k); });
			var more = h('select', { class: 'kit-input ts-more-genre', aria: { label: 'Another genre' } });
			more.appendChild(h('option', { value: '', text: 'Another genre' + ELL }));
			T.FAMILIES.forEach(function (f) { var og = h('optgroup', { label: f.name }); f.list.forEach(function (g) { og.appendChild(h('option', { value: g.name, text: g.name })); }); more.appendChild(og); });
			more.addEventListener('change', function () { if (more.value && fields.genres.indexOf(more.value) < 0) { if (fields.genres.length >= 3) fields.genres.pop(); fields.genres.push(more.value); } redraw(); });
			gbox.appendChild(more);
			dyn.appendChild(gbox);
			var scenes = T.SCENES.slice().sort(function (a, b) { return (sg.scenes.indexOf(b[0]) >= 0) - (sg.scenes.indexOf(a[0]) >= 0); });
			dyn.appendChild(chipsRow('Scene', 'scene', scenes, false));
			dyn.appendChild(chipsRow('Role', 'role', T.ROLES, false));
			dyn.appendChild(chipsRow('Language', 'lang', T.LANGS, false));
			dyn.appendChild(chipsRow('Kind', 'kind', T.KINDS, false));
		}
		redraw();
		card2.appendChild(g2);
		card2.appendChild(dyn);
		var btns = h('div', { class: 'ts-row-btns' });
		function save() {
			var out = {};
			['artist', 'title', 'work'].forEach(function (k) { var v = String(fields[k] || '').trim(); if (v !== String(t[k] || '')) out[k] = v || null; });
			['mood', 'scene', 'role', 'lang', 'kind'].forEach(function (k) { if (fields[k] !== (t[k] || '')) out[k] = fields[k]; });
			if (fields.genres.join('|') !== t.genres.join('|') && fields.genres.length) out.genres = fields.genres.slice();
			if (!out.mood && !t.mood && fields.mood) out.mood = fields.mood;
			out.kind = fields.kind || 'song';
			L.edit(lib, t.id, out);
			changed([t.id]);
			labelAt++;
			renderView(false);
		}
		btns.appendChild(actionBtn('check', 'Save and next', save, true));
		btns.appendChild(actionBtn('fwd', 'Skip', function () { labelAt++; renderView(false); }));
		if (labelAt > 0) btns.appendChild(actionBtn('back', 'Back', function () { labelAt--; renderView(false); }));
		card2.appendChild(btns);
		view.appendChild(card2);
		labelKeys = function (e) {
			var tag = (e.target && e.target.tagName) || '';
			if (/^(BUTTON|A|SUMMARY|SELECT|TEXTAREA)$/.test(tag) || !(e.target.closest && e.target.closest('#view'))) return false;
			if (tag === 'INPUT' && e.key !== 'Enter') return false;
			if (e.key >= '1' && e.key <= '6') { fields.mood = T.MOODS[+e.key - 1][0]; redraw(); return true; }
			if (e.key === 'Enter') { save(); return true; }
			if (e.key === 'ArrowRight') { labelAt++; renderView(false); return true; }
			if (e.key === 'ArrowLeft' && labelAt > 0) { labelAt--; renderView(false); return true; }
			if (e.key === 'p' || e.key === 'P') { playIds([t.id], 0, { label: 'Labelling', href: '#/label' }); return true; }
			return false;
		};
		if (first && !fields.artist) first.focus();
	}
	var labelKeys = null;

	// ---- The map -------------------------------------------------------------------------------------------

	var E = TS.embed;
	var mapState = { recipe: ToyKit.load('mapRecipe', 'labels'), color: ToyKit.load('mapColor', 'family'), cache: {}, view: null, sel: [], hover: -1, find: '', lm: null, lmJob: null, hidden: {} };
	var PAL = {
		light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
		dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
	};
	var OTHER_GREY = { light: '#9aa1ab', dark: '#5f6670' };
	function mapKey(tracks) { return mapState.recipe + '|' + tracks.length + '|' + S.signature(tracks.map(function (t) { return t.id + (t.genres[0] || '') + t.mood; }).join(',')); }
	function categoriesFor(tracks) {
		var by = mapState.color, cnt = {}, name = {};
		function cat(t) {
			if (by === 'family') { var f = T.trackFamily(t); name[f] = (T.family(f) || {}).name || f; return f; }
			if (by === 'mood') { name[t.mood || ''] = T.MOOD_NAME[t.mood] || 'No mood'; return t.mood || ''; }
			if (by === 'scene') { name[t.scene || ''] = T.SCENE_NAME[t.scene] || 'No scene'; return t.scene || ''; }
			if (by === 'lang') { name[t.lang || ''] = T.LANG_NAME[t.lang] || 'Unknown'; return t.lang || ''; }
			return '';
		}
		var keys = tracks.map(cat);
		keys.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; });
		// eight slots in a fixed order of size; the rest folds into Other
		var order = Object.keys(cnt).filter(function (k) { return k && k !== 'other'; }).sort(function (a, b) { return cnt[b] - cnt[a]; });
		if (by === 'mood') order = T.MOODS.map(function (m) { return m[0]; }).filter(function (m) { return cnt[m]; });
		var slots = order.slice(0, 7), slot = {};
		slots.forEach(function (k, i) { slot[k] = i; });
		var legend = slots.map(function (k, i) { return { key: k, name: name[k], count: cnt[k], slot: i }; });
		var otherCount = 0;
		keys.forEach(function (k) { if (slot[k] == null) otherCount++; });
		if (otherCount) legend.push({ key: '__other', name: 'Other', count: otherCount, slot: -1 });
		return { keys: keys.map(function (k) { return slot[k] == null ? '__other' : k; }), slot: slot, legend: legend };
	}
	function seqColor(v, dark) { // one blue ramp, light to dark (or the reverse on dark)
		var ramp = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
		var i = Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))));
		return dark ? ramp[ramp.length - 1 - Math.min(i, ramp.length - 2)] : ramp[i];
	}
	function viewMap(view) {
		if (mapState.recipe === 'lm' && !mapState.lm) mapState.recipe = 'labels';
		var tracks = scopeTracks().filter(function (t) { return t.kind !== 'clip'; });
		view.classList.add('is-map');
		if (tracks.length < 8) { view.appendChild(h('p', { class: 'ts-empty', text: 'The map needs at least eight songs here.' })); return; }
		var bar = h('div', { class: 'ts-mapbar' });
		var rs = h('select', { class: 'kit-input', aria: { label: 'Embedding' } });
		E.RECIPES.forEach(function (r) { rs.appendChild(h('option', { value: r.key, text: r.name + (r.key === 'lm' && !mapState.lm ? ' (download)' : '') })); });
		rs.value = mapState.recipe;
		var cs = h('select', { class: 'kit-input', aria: { label: 'Colour by' } });
		[['family', 'Colour: genre family'], ['mood', 'Colour: mood'], ['scene', 'Colour: scene'], ['lang', 'Colour: language'], ['year', 'Colour: year'], ['plays', 'Colour: plays']].forEach(function (o) { cs.appendChild(h('option', { value: o[0], text: o[1] })); });
		cs.value = mapState.color;
		var fi = h('input', { class: 'kit-input ts-mapfind', type: 'search', placeholder: 'Find on the map', value: mapState.find, aria: { label: 'Find on the map' } });
		var info = h('span', { class: 'ts-muted ts-mapinfo', aria: { live: 'polite' } });
		bar.appendChild(rs); bar.appendChild(cs); bar.appendChild(fi);
		bar.appendChild(U.iconBtn('plus', 'Zoom in', { on: { click: function () { zoomBy(1.4); } } }));
		bar.appendChild(U.iconBtn('rotate', 'Fit the whole map', { on: { click: function () { mapState.view = null; draw(); } } }));
		bar.appendChild(info);
		view.appendChild(bar);
		view.appendChild(h('p', { class: 'ts-muted ts-mapblurb', text: (E.RECIPES.filter(function (r) { return r.key === mapState.recipe; })[0] || {}).blurb + ' Drag to pan, scroll or pinch to zoom, click a dot, Shift-drag a box to pick a region.' }));
		var wrap = h('div', { class: 'ts-mapwrap' });
		var cv = h('canvas', { class: 'ts-map', role: 'img', tabindex: '0', aria: { label: 'A map of ' + plural(tracks.length, 'song') + ': similar songs sit close together. The regions are listed below the map.' } });
		var tip = h('div', { class: 'ts-maptip', hidden: true });
		var side = h('div', { class: 'ts-mapside' });
		var legendBox = h('div', { class: 'ts-maplegend' });
		wrap.appendChild(cv); wrap.appendChild(tip); wrap.appendChild(legendBox); wrap.appendChild(side);
		view.appendChild(wrap);
		var regionBox = h('div', { class: 'ts-regions' });
		view.appendChild(regionBox);

		rs.addEventListener('change', function () {
			if (rs.value === 'lm' && !mapState.lm) { rs.value = mapState.recipe; askLM(); return; }
			mapState.recipe = rs.value; ToyKit.store('mapRecipe', rs.value); mapState.view = null; mapState.sel = []; renderView(true);
		});
		cs.addEventListener('change', function () { mapState.color = cs.value; ToyKit.store('mapColor', cs.value); mapState.hidden = {}; drawLegend(); draw(); });
		fi.addEventListener('input', function () { mapState.find = fi.value; draw(); });

		var key = mapKey(tracks), entry = mapState.cache[key];
		if (mapState.selKey !== key) { mapState.sel = []; mapState.hover = -1; mapState.selKey = key; }
		var ctx2 = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), W = 0, H = 0, cats = null;
		if (!entry) {
			Object.keys(mapState.cache).forEach(function (k) { delete mapState.cache[k]; });
			entry = mapState.cache[key] = { tracks: tracks, pos: null, regions: [], done: false, info: info };
			info.textContent = 'Reading the songs' + ELL;
			var vecs = E.vectors(tracks, mapState.recipe, { taxonomy: T, firstAdded: L.firstAdded, lm: mapState.lm });
			var kj = E.knnJob(vecs, 15), lay = null, r = S.rng('map-' + mapState.recipe);
			entry.vecs = vecs;
			var later = function (f) { if (route.parts[0] === 'map') requestAnimationFrame(f); else setTimeout(f, 50); };
			(function tick() {
				if (mapState.cache[key] !== entry) return;
				if (!kj.done) { kj.step(14); entry.info.textContent = 'Finding neighbours ' + Math.round(100 * kj.progress) + '%'; later(tick); return; }
				if (!lay) { entry.nn = kj.result; lay = E.layout(vecs, kj.result, { rand: r }); entry.pos = lay.pos; }
				lay.step(ToyKit.reducedMotion ? null : 14);
				entry.info.textContent = lay.done ? '' : 'Laying out ' + Math.round(100 * lay.progress) + '%';
				if (lay.done) { entry.done = true; entry.regions = E.regions(entry.pos, tracks, Math.round(Math.min(18, Math.max(6, tracks.length / 110))), S.rng('regions')); if (entry.onDone) entry.onDone(); return; }
				if (mapRedraw) mapRedraw();
				later(tick);
			})();
		}
		entry.info = info;
		// the middle 96% of the points, so a few strays do not shrink the rest
		function bounds() {
			var p = entry.pos, xs = [], ys = [];
			for (var i = 0; i < tracks.length; i++) { xs.push(p[2 * i]); ys.push(p[2 * i + 1]); }
			xs.sort(function (a, b) { return a - b; }); ys.sort(function (a, b) { return a - b; });
			var lo = Math.floor(xs.length * 0.02), hi = Math.max(lo, Math.ceil(xs.length * 0.98) - 1);
			return { x0: xs[lo], x1: xs[hi], y0: ys[lo], y1: ys[hi] };
		}
		function fit() {
			var b = bounds(), pad = 40, sx = (W - 2 * pad) / Math.max(1e-6, b.x1 - b.x0), sy = (H - 2 * pad) / Math.max(1e-6, b.y1 - b.y0), s = Math.min(sx, sy);
			return { s: s, tx: W / 2 - s * (b.x0 + b.x1) / 2, ty: H / 2 - s * (b.y0 + b.y1) / 2 };
		}
		var fitMemo = null;
		function V() { return mapState.view || fitMemo || (fitMemo = fit()); }
		function sx(i) { var v = V(); return v.tx + v.s * entry.pos[2 * i]; }
		function sy(i) { var v = V(); return v.ty + v.s * entry.pos[2 * i + 1]; }
		function resize() {
			var r2 = wrap.getBoundingClientRect();
			W = Math.max(200, r2.width); H = Math.max(240, r2.height);
			cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
			cv.style.width = W + 'px'; cv.style.height = H + 'px';
			fitMemo = null;
		}
		function colorOf(i, dark) {
			var t = tracks[i];
			if (mapState.color === 'year') { return t.year ? seqColor(Math.max(0, Math.min(1, (t.year - 1960) / 66)), dark) : (dark ? OTHER_GREY.dark : OTHER_GREY.light); }
			if (mapState.color === 'plays') { return seqColor(Math.min(1, Math.log(1 + t.plays) / Math.log(30)), dark); }
			var k = cats.keys[i], sl = cats.slot[k];
			return sl == null ? (dark ? OTHER_GREY.dark : OTHER_GREY.light) : (dark ? PAL.dark : PAL.light)[sl];
		}
		function matches(t, f) { return f && Parse.fold(trackTitle(t) + ' ' + (t.titleAlt || '') + ' ' + trackArtist(t) + ' ' + (t.artistNative || '') + ' ' + (t.work || '')).indexOf(f) >= 0; }
		function draw() {
			if (!entry.pos || !cv.isConnected) return;
			if (!entry.done || !fitMemo) fitMemo = null;
			var dark = ToyKit.theme() === 'dark';
			if (!cats) cats = categoriesFor(tracks);
			ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx2.clearRect(0, 0, W, H);
			var f = Parse.fold(mapState.find.trim()), anyFind = !!f, selSet = {};
			mapState.sel.forEach(function (i) { selSet[i] = true; });
			var v = V();
			var r = Math.max(2.2, Math.min(6, 2.4 + v.s / 40));
			var cur = ctl && ctl.current(), curI = -1;
			// the path of what plays next
			var st = ctl ? ctl.state() : null, path = [];
			var at = {};
			tracks.forEach(function (t, i) { at[t.id] = i; });
			if (st && st.items.length) { for (var p = st.index; p < Math.min(st.items.length, st.index + 9); p++) if (at[st.items[p]] != null) path.push(at[st.items[p]]); }
			for (var i = 0; i < tracks.length; i++) {
				var t = tracks[i], hidden = mapState.hidden[cats.keys[i]] && mapState.color !== 'year' && mapState.color !== 'plays';
				var dim = hidden || (anyFind && !matches(t, f)) || (mapState.sel.length > 1 && !selSet[i]);
				ctx2.globalAlpha = dim ? 0.13 : 0.9;
				ctx2.fillStyle = colorOf(i, dark);
				ctx2.beginPath(); ctx2.arc(sx(i), sy(i), anyFind && !dim ? r * 1.6 : r, 0, 6.2832); ctx2.fill();
				if (t.id === cur) curI = i;
			}
			ctx2.globalAlpha = 1;
			if (path.length > 1) {
				ctx2.strokeStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(20,24,30,0.55)';
				ctx2.lineWidth = 1.5;
				ctx2.setLineDash([4, 4]);
				ctx2.beginPath(); ctx2.moveTo(sx(path[0]), sy(path[0]));
				for (var k = 1; k < path.length; k++) ctx2.lineTo(sx(path[k]), sy(path[k]));
				ctx2.stroke(); ctx2.setLineDash([]);
			}
			function ring(i2, rad, color, w) { ctx2.strokeStyle = color; ctx2.lineWidth = w; ctx2.beginPath(); ctx2.arc(sx(i2), sy(i2), rad, 0, 6.2832); ctx2.stroke(); }
			var ink = dark ? '#ffffff' : '#0d1117', surf = dark ? '#13161b' : '#f7f8fa';
			if (curI >= 0) { ring(curI, r + 7, ink, 2); ring(curI, r + 3, surf, 2); }
			if (mapState.sel.length === 1) ring(mapState.sel[0], r + 5, ink, 2);
			if (mapState.hover >= 0) ring(mapState.hover, r + 4, ink, 1.5);
			// region names
			if (entry.done && !anyFind) {
				ctx2.font = '650 12.5px ' + getComputedStyle(document.body).fontFamily;
				ctx2.textAlign = 'center';
				entry.regions.forEach(function (rg) {
					var x = v.tx + v.s * rg.x, y = v.ty + v.s * rg.y;
					ctx2.lineWidth = 4; ctx2.strokeStyle = surf; ctx2.strokeText(rg.name, x, y);
					ctx2.fillStyle = ink; ctx2.fillText(rg.name, x, y);
				});
			}
			if (drag && drag.box) {
				ctx2.strokeStyle = ink; ctx2.lineWidth = 1; ctx2.setLineDash([3, 3]);
				ctx2.strokeRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
				ctx2.setLineDash([]);
			}
		}
		function drawLegend() {
			clear(legendBox);
			cats = categoriesFor(tracks);
			if (mapState.color === 'year' || mapState.color === 'plays') {
				var lo = mapState.color === 'year' ? '1960' : '0 plays', hi = mapState.color === 'year' ? '2026' : '30+';
				legendBox.appendChild(h('div', { class: 'ts-ramp' }, [h('span', { text: lo }), h('i', { class: 'ts-ramp-bar' }), h('span', { text: hi })]));
				return;
			}
			var dark = ToyKit.theme() === 'dark';
			cats.legend.forEach(function (e) {
				var off = !!mapState.hidden[e.key];
				var b = h('button', { class: 'ts-leg' + (off ? ' is-off' : ''), aria: { pressed: off ? 'false' : 'true' }, title: off ? 'Show ' + e.name : 'Fade ' + e.name }, [h('i', { style: { background: e.slot < 0 ? (dark ? OTHER_GREY.dark : OTHER_GREY.light) : (dark ? PAL.dark : PAL.light)[e.slot] } }), h('span', { text: e.name }), h('span', { class: 'ts-count', text: n(e.count) })]);
				b.addEventListener('click', function () { if (mapState.hidden[e.key]) delete mapState.hidden[e.key]; else mapState.hidden[e.key] = true; drawLegend(); draw(); });
				legendBox.appendChild(b);
			});
		}
		function drawRegions() {
			clear(regionBox);
			if (!entry.regions.length) return;
			regionBox.appendChild(h('h2', { class: 'ts-sec-head', text: 'Regions' }));
			var g = h('div', { class: 'ts-chips' });
			entry.regions.slice().sort(function (a, b) { return b.size - a.size; }).forEach(function (rg) {
				var ids = rg.members.map(function (i) { return tracks[i].id; });
				g.appendChild(h('button', { class: 'ts-chip', title: 'Pick this region', on: { click: function () { mapState.sel = rg.members.slice(); showSide(); draw(); } } }, [h('span', { text: rg.name }), h('span', { class: 'ts-count', text: n(ids.length) })]));
			});
			regionBox.appendChild(g);
		}
		function nearestTo(i, k) {
			var out = [], px = entry.pos[2 * i], py = entry.pos[2 * i + 1];
			for (var j = 0; j < tracks.length; j++) { var dx = entry.pos[2 * j] - px, dy = entry.pos[2 * j + 1] - py; out.push([dx * dx + dy * dy, j]); }
			out.sort(function (a, b) { return a[0] - b[0]; });
			return out.slice(0, k).map(function (x) { return x[1]; });
		}
		function showSide() {
			clear(side);
			side.hidden = !mapState.sel.length;
			if (!mapState.sel.length) return;
			if (mapState.sel.length === 1) {
				var i = mapState.sel[0], t = tracks[i];
				side.appendChild(artFor(t, 'ts-mapside-art'));
				side.appendChild(h('a', { class: 'ts-mapside-title', href: link('track', t.id), text: trackTitle(t) }));
				side.appendChild(artistLinks(t, 'ts-r-sub'));
				var ch = h('div', { class: 'ts-chips is-tight' });
				t.genres.slice(0, 2).forEach(function (g) { ch.appendChild(chip(g, link('genre', g), T.hueOf(g), 'is-small')); });
				if (t.mood) ch.appendChild(chip(T.MOOD_NAME[t.mood], link('c', 'mood', t.mood), { h: MOOD_HUE[t.mood], s: 60 }, 'is-small'));
				side.appendChild(ch);
				var row = h('div', { class: 'ts-row-btns' });
				row.appendChild(actionBtn('play', 'Play', function () { playIds([t.id], 0, { label: trackTitle(t), href: '#/map' }); }, true));
				row.appendChild(actionBtn('radio', 'Neighbourhood', function () {
					var near = nearestTo(i, 40).map(function (j) { return tracks[j]; }), rest = near.slice(1);
					playIds([t.id].concat(S.spreadShuffle(rest, S.cryptoRng(), {})), 0, { label: 'Around ' + trackTitle(t), href: '#/map' });
				}));
				side.appendChild(row);
			} else {
				var ids = mapState.sel.map(function (j) { return tracks[j].id; });
				side.appendChild(h('p', { class: 'ts-mapside-title', text: plural(ids.length, 'song') + ' picked' }));
				var gc = {};
				ids.forEach(function (id) { (lib.tracks[id].genres || []).slice(0, 1).forEach(function (g) { gc[g] = (gc[g] || 0) + 1; }); });
				side.appendChild(h('p', { class: 'ts-muted', text: Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a]; }).slice(0, 3).join(', ') }));
				var row2 = h('div', { class: 'ts-row-btns' });
				row2.appendChild(actionBtn('shuffle', 'Shuffle these', function () { playIds(S.spreadShuffle(ids.map(function (id) { return lib.tracks[id]; }), S.cryptoRng(), {}), 0, { label: 'Map region', href: '#/map' }); }, true));
				row2.appendChild(actionBtn('plus', 'Save as playlist', function () { createList('manual', { ids: ids }, 'Map region', { focus: false, go: false }); }));
				row2.appendChild(actionBtn('close', 'Clear', function () { mapState.sel = []; showSide(); draw(); }));
				side.appendChild(row2);
			}
		}
		function hit(x, y) {
			var best = -1, bd = 14 * 14;
			for (var i = 0; i < tracks.length; i++) { var dx = sx(i) - x, dy = sy(i) - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
			return best;
		}
		function zoomBy(f, cx, cy) {
			var v = V();
			cx = cx == null ? W / 2 : cx; cy = cy == null ? H / 2 : cy;
			mapState.view = { s: v.s * f, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
			draw();
		}
		var drag = null, pointers = {};
		cv.addEventListener('pointerdown', function (e) {
			cv.setPointerCapture(e.pointerId);
			pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
			var ids = Object.keys(pointers);
			if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
			drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, box: e.shiftKey, moved: false, v: V() };
		});
		cv.addEventListener('pointermove', function (e) {
			if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
			if (drag && drag.pinch) {
				var ids = Object.keys(pointers);
				if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y); zoomBy(d / drag.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); drag.pinch = d; }
				return;
			}
			if (drag) {
				drag.x1 = e.offsetX; drag.y1 = e.offsetY;
				if (Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) > 4) drag.moved = true;
				if (!drag.box && drag.moved) mapState.view = { s: drag.v.s, tx: drag.v.tx + drag.x1 - drag.x0, ty: drag.v.ty + drag.y1 - drag.y0 };
				draw();
				return;
			}
			var i = hit(e.offsetX, e.offsetY);
			if (i !== mapState.hover) {
				mapState.hover = i;
				if (i >= 0) {
					var t = tracks[i];
					clear(tip);
					tip.appendChild(h('b', { text: trackTitle(t) }));
					tip.appendChild(h('span', { text: trackArtist(t) + (t.work ? ' ' + DOT + ' ' + t.work : '') }));
					tip.appendChild(h('span', { class: 'ts-muted', text: [t.genres[0], T.MOOD_NAME[t.mood]].filter(Boolean).join(' ' + DOT + ' ') }));
					tip.hidden = false;
					tip.style.left = Math.min(W - 220, sx(i) + 12) + 'px';
					tip.style.top = Math.max(0, sy(i) - 10) + 'px';
				} else tip.hidden = true;
				draw();
			}
		});
		function up(e) {
			delete pointers[e.pointerId];
			if (!drag) return;
			var d = drag;
			drag = Object.keys(pointers).length ? drag : null;
			if (d.pinch) { drag = null; return; }
			if (d.box && d.moved) {
				var x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
				mapState.sel = [];
				for (var i = 0; i < tracks.length; i++) if (sx(i) >= x0 && sx(i) <= x1 && sy(i) >= y0 && sy(i) <= y1) mapState.sel.push(i);
				showSide(); draw(); return;
			}
			if (!d.moved) { var j = hit(d.x0, d.y0); mapState.sel = j >= 0 ? [j] : []; showSide(); draw(); }
		}
		cv.addEventListener('pointerup', up);
		cv.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; drag = null; draw(); });
		cv.addEventListener('pointerleave', function () { mapState.hover = -1; tip.hidden = true; draw(); });
		cv.addEventListener('dblclick', function (e) { var i = hit(e.offsetX, e.offsetY); if (i >= 0) playIds([tracks[i].id], 0, { label: trackTitle(tracks[i]), href: '#/map' }); });
		cv.addEventListener('wheel', function (e) { e.preventDefault(); zoomBy(Math.exp(-e.deltaY / 400), e.offsetX, e.offsetY); }, { passive: false });
		cv.addEventListener('keydown', function (e) {
			var v = V(), step = 60;
			if (e.key === 'ArrowLeft') mapState.view = { s: v.s, tx: v.tx + step, ty: v.ty };
			else if (e.key === 'ArrowRight') mapState.view = { s: v.s, tx: v.tx - step, ty: v.ty };
			else if (e.key === 'ArrowUp') mapState.view = { s: v.s, tx: v.tx, ty: v.ty + step };
			else if (e.key === 'ArrowDown') mapState.view = { s: v.s, tx: v.tx, ty: v.ty - step };
			else if (e.key === '+' || e.key === '=') { zoomBy(1.3); e.preventDefault(); return; }
			else if (e.key === '-') { zoomBy(1 / 1.3); e.preventDefault(); return; }
			else if (e.key === 'Escape') { mapState.sel = []; showSide(); }
			else return;
			e.preventDefault(); e.stopPropagation(); draw();
		});
		var ro = window.ResizeObserver ? new ResizeObserver(function () { if (!cv.isConnected) { ro.disconnect(); return; } resize(); draw(); }) : null;
		if (ro) ro.observe(wrap);
		resize();
		drawLegend();
		if (entry.done) drawRegions();
		showSide();
		mapRedraw = draw;
		entry.onDone = function () { if (mapRedraw === draw) { drawRegions(); draw(); } };
		draw();
	}
	var mapRedraw = null;

	// The optional language model: transformers.js from jsDelivr and a
	// multilingual sentence model from Hugging Face, only on request.
	var LM_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
	var LM_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
	function askLM() {
		var d = U.openDialog({ title: 'Map with a language model?' });
		d.body.appendChild(h('p', { text: 'A multilingual sentence model reads a one-line description of every song (title, artist, work, genres, mood) and places songs by meaning, in Japanese and English alike. It runs in this browser. The first time it downloads about 120 MB from Hugging Face (huggingface.co) and the transformers.js library from jsDelivr; the browser keeps them afterwards. Song descriptions never leave your computer.' }));
		var row = h('div', { class: 'ts-row-btns' });
		var go = h('button', { class: 'kit-btn primary', text: 'Download and compute' });
		var stat = h('p', { class: 'ts-muted', aria: { live: 'polite' } });
		go.addEventListener('click', function () { go.disabled = true; computeLM(function (s) { stat.textContent = s; }).then(function () { d.close(); mapState.recipe = 'lm'; ToyKit.store('mapRecipe', 'lm'); renderView(true); }).catch(function (err) { go.disabled = false; stat.textContent = 'It did not work: ' + (err && err.message || err) + '. The other maps still work.'; }); });
		row.appendChild(go);
		row.appendChild(h('button', { class: 'kit-btn', text: 'Not now', on: { click: d.close } }));
		d.body.appendChild(row);
		d.body.appendChild(stat);
	}
	function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }
	function unb64(s) { var bin = atob(s), out = new Int8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) << 24 >> 24; return out; }
	function loadLM() {
		if (thumb || demo) return Promise.resolve();
		return store.get('lm:vectors', null).then(function (saved) {
			if (!saved || saved.model !== LM_MODEL || !saved.data) return;
			var raw = unb64(saved.data), dim = saved.dim, out = {};
			saved.ids.forEach(function (id, i) { var v = new Float32Array(dim); for (var j = 0; j < dim; j++) v[j] = raw[i * dim + j] / 127; out[id] = v; });
			mapState.lm = out;
		}).catch(function () { /* no vectors kept */ });
	}
	function computeLM(onStatus) {
		onStatus('Loading transformers.js' + ELL);
		return import(LM_LIB).then(function (tf) {
			onStatus('Loading the model (about 120 MB the first time)' + ELL);
			return tf.pipeline('feature-extraction', LM_MODEL, { dtype: 'q8', progress_callback: function (p) { if (p && p.status === 'progress' && p.total) onStatus('Downloading ' + Math.round(100 * p.loaded / p.total) + '% of ' + (p.file || 'the model')); } });
		}).then(function (pipe) {
			var all = L.list(lib), out = {}, i = 0, B = 16;
			function next() {
				if (i >= all.length) return Promise.resolve();
				var batch = all.slice(i, i + B);
				return pipe(batch.map(function (t) { return E.describe(t, T); }), { pooling: 'mean', normalize: true }).then(function (res) {
					var dim = res.dims[res.dims.length - 1], data = res.data;
					batch.forEach(function (t, k) { out[t.id] = Float32Array.from(data.subarray(k * dim, (k + 1) * dim)); });
					i += B;
					onStatus('Reading songs: ' + Math.min(i, all.length) + ' of ' + all.length);
					return new Promise(function (r) { setTimeout(r, 0); }).then(next);
				});
			}
			return next().then(function () {
				mapState.lm = out;
				mapState.cache = {};
				var ids = Object.keys(out), dim = out[ids[0]].length, q8 = new Int8Array(ids.length * dim);
				ids.forEach(function (id, k) { var v = out[id]; for (var j = 0; j < dim; j++) q8[k * dim + j] = Math.max(-127, Math.min(127, Math.round(v[j] * 127))); });
				return store.set('lm:vectors', { model: LM_MODEL, dim: dim, ids: ids, data: b64(new Uint8Array(q8.buffer)) });
			});
		});
	}

	// ---- Sync with the Desk ------------------------------------------------------------------------------
	// sync:outbox holds the owner's own data (labels, ratings, plays, stations,
	// history), never YouTube's; the Desk pushes it to the private repository.
	// sync:inbox is what the Desk pulled; it is merged here and removed.

	var queueSync = later(function () {
		if (thumb || demo || !store || !L.list(lib).length) return;
		var state = {};
		L.list(lib).forEach(function (t) { if (t.rating || t.blocked || t.plays || t.skips) state[t.id] = { rating: t.rating, blocked: t.blocked, plays: t.plays, skips: t.skips, lastPlayed: t.lastPlayed, stateAt: t.stateAt || null }; });
		store.set('sync:outbox', { format: 'true-shuffle-sync', version: 1, savedAt: new Date().toISOString(), labels: L.exportLabels(lib, Date.now()), state: state, stations: lists, history: histCache.slice(0, 5000) });
	}, 4000);
	var inboxBusy = null;
	function checkInbox() {
		if (thumb || demo || !store) return Promise.resolve();
		if (inboxBusy) return inboxBusy;
		inboxBusy = store.get('sync:inbox', null).then(function (box) {
			if (!box || box.format !== 'true-shuffle-sync' || +box.version !== 1) return;
			var ids = [];
			if (box.labels && box.labels.format === L.LABELS_FORMAT) ids = L.applyLabels(lib, box.labels).ids.concat(Object.keys(box.labels.tracks || {}).filter(function (id) { return lib.tracks[id]; }));
			var st = box.state || {}, touched = 0;
			Object.keys(st).forEach(function (id) {
				var t = lib.tracks[id], s = st[id];
				if (!t || !s) return;
				var newer = s.stateAt && (!t.stateAt || s.stateAt > t.stateAt);
				if (newer) { t.rating = +s.rating || 0; t.blocked = !!s.blocked; t.stateAt = s.stateAt; }
				t.plays = Math.max(t.plays, +s.plays || 0);
				t.skips = Math.max(t.skips, +s.skips || 0);
				if (s.lastPlayed && (!t.lastPlayed || s.lastPlayed > t.lastPlayed)) t.lastPlayed = s.lastPlayed;
				ids.push(id); touched++;
			});
			var names = {};
			lists.forEach(function (li) { names[li.id] = true; });
			(box.stations || []).forEach(function (li) { if (li && li.id && !names[li.id]) lists.push(li); });
			var have = {};
			histCache.forEach(function (e) { have[e.id + '@' + e.at] = true; });
			var extra = (box.history || []).filter(function (e) { return e && !have[e.id + '@' + e.at]; });
			return Promise.all(extra.map(function (e) { return store.addHistory(e); })).then(function () {
				return store.set('sync:inbox', null);
			}).then(function () {
				histCache = histCache.concat(extra).sort(function (a, b) { return b.at - a.at; });
				saveLists();
				return changed(ids, true);
			}).then(function () { say('Merged what the Desk pulled: labels, ' + plural(touched, 'track') + ' of ratings and plays, playlists and history.'); });
		}).catch(fail).then(function () { inboxBusy = null; });
		return inboxBusy;
	}

	// ---- Small things: repeat, sleep timer, work roles -------------------------------------------------

	var sleep = null;
	function sleepMenu(anchor) {
		var items = [{ heading: sleep ? 'Sleep timer: ' + (sleep.end === 'track' ? 'end of this track' : 'stops at ' + new Date(sleep.at).toTimeString().slice(0, 5)) : 'Pause playback after' }];
		[15, 30, 45, 60, 90].forEach(function (m) { items.push({ label: m + ' minutes', icon: 'newest', onSelect: function () { setSleep({ at: Date.now() + m * 60000 }); } }); });
		items.push({ label: 'The end of this track', icon: 'disc', onSelect: function () { setSleep({ end: 'track', id: ctl && ctl.current() }); } });
		if (sleep) items.push({ label: 'Turn the timer off', icon: 'close', onSelect: function () { setSleep(null); } });
		U.openMenu(anchor, items, { label: 'Sleep timer' });
	}
	function setSleep(s) {
		if (sleep && sleep.timer) clearTimeout(sleep.timer);
		sleep = s;
		if (s && s.at) s.timer = setTimeout(function () { var st = player.state(); if (st === 'playing') ctl.pause(); else if (st !== 'paused' && st !== 'idle') pauseOnStart = true; pvClose(); stopPreview(); sleep = null; renderSleep(); say('Sleep timer: paused.'); }, s.at - Date.now());
		renderSleep();
		if (s) say(s.end === 'track' ? 'Playback pauses when this track ends.' : 'Playback pauses at ' + new Date(s.at).toTimeString().slice(0, 5) + '.');
	}
	function renderSleep() { var b = $('btn-sleep'); if (b) { b.classList.toggle('is-on', !!sleep); b.setAttribute('aria-pressed', sleep ? 'true' : 'false'); } }
	function toggleRepeat() {
		if (!ctl) return;
		var on = !ctl.state().repeat;
		ctl.setRepeat(on);
		renderRepeat();
		say(on ? 'Repeat on: the queue starts again when it ends.' : 'Repeat off.');
	}
	function renderRepeat() { var b = $('btn-repeat'); if (b && ctl) { var on = !!ctl.state().repeat; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); } }

	// ---- Discover: songs like this one that are not in the library -----------------------------------
	// Related artists and their best songs from Deezer (through the sandboxed
	// transport in discover.js), 30-second previews, and one YouTube search to
	// play a find (kept in the local playlist "Discovered").

	var DX = TS.discover, dz = null, discoverHidden = null, previewAudio = null, previewing = null;
	var DISCOVERED = 'local:discovered';
	function deezer() { if (!dz) dz = DX.createDeezer({ transport: DX.sandboxTransport() }); return dz; }
	function loadHidden() { if (discoverHidden) return Promise.resolve(discoverHidden); if (thumb || !store) { discoverHidden = {}; return Promise.resolve(discoverHidden); } return store.get('discover:hidden', {}).then(function (h2) { discoverHidden = h2 || {}; return discoverHidden; }); }
	function knownArtistName(name) { var k = L.normArtist(name); return !!(k && (idx().artists[k] || L.list(lib).some(function (t) { return t.artistKey === k || L.normArtist(t.artistNative) === k; }))); }
	// The names and titles that identify an artist on Deezer.
	function artistEvidence(key) {
		var a = L.list(lib).filter(function (t) { return t.artistKey === key; });
		var names = [], titles = [];
		a.forEach(function (t) {
			[t.artist, t.artistNative].forEach(function (n2) { if (n2 && names.indexOf(n2) < 0) names.push(n2); });
			[t.title, t.titleAlt].forEach(function (x) { if (x && titles.indexOf(x) < 0) titles.push(x); });
		});
		return { names: names, titles: titles, tracks: a };
	}
	// Library artists that sound closest to a key: shared genres, weighted.
	function nearArtists(key, k) {
		var ix = idx(), a = ix.artists[key];
		if (!a) return [];
		var mine = {};
		a.tracks.forEach(function (t) { t.genres.forEach(function (g, i) { mine[g] = (mine[g] || 0) + (i ? 0.6 : 1); }); });
		var out = [];
		Object.keys(ix.artists).forEach(function (o) {
			if (o === key) return;
			var b = ix.artists[o], s = 0;
			b.tracks.forEach(function (t) { t.genres.forEach(function (g) { if (mine[g]) s += mine[g]; }); });
			if (s > 0) out.push({ key: o, s: s / Math.sqrt(b.tracks.length) });
		});
		return out.sort(function (x, y) { return y.s - x.s; }).slice(0, k).map(function (x) { return x.key; });
	}
	function stopPreview() {
		if (previewAudio) { previewAudio.pause(); previewAudio = null; }
		var old = previewing;
		previewing = null;
		if (old && old.btn) { U.setIcon(old.btn, 'play'); old.btn.setAttribute('aria-label', 'Preview ' + old.title); old.btn.classList.remove('is-on'); }
	}
	function preview(t, btn) {
		if (previewing && previewing.id === t.id) { stopPreview(); return; }
		stopPreview();
		pvClose();
		if (!t.preview) { say('No preview for this song.'); return; }
		if (player && player.state() === 'playing') ctl.toggle();
		previewAudio = new Audio(t.preview);
		previewAudio.addEventListener('ended', stopPreview);
		previewAudio.play().catch(function () { say('The preview could not be played.'); stopPreview(); });
		previewing = { id: t.id, btn: btn, title: t.title };
		U.setIcon(btn, 'pause');
		btn.classList.add('is-on');
		btn.setAttribute('aria-label', 'Stop the preview');
	}
	// Find the song on YouTube and play it; it joins the "Discovered" playlist.
	function playFound(t, btn) {
		stopPreview();
		var q2 = DX.youtubeQuery(t);
		if (demo) { say('The demo cannot search YouTube.'); return; }
		if (!auth.signedIn()) { window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q2), '_blank', 'noopener'); return; }
		if (btn) btn.disabled = true;
		setStatus('Searching YouTube for ' + q(q2) + ELL);
		(t._video ? Promise.resolve([t._video]) : client.search(q2, { max: 6 })).then(function (results) {
			var best = t._video || DX.bestVideo(results, t);
			if (!best) throw new Error('YouTube found nothing for ' + q(q2) + '.');
			if (lib.tracks[best.videoId]) return best.videoId;
			return client.videoBatch([best.videoId]).then(function (res) {
				if (!res.videos.length) throw new Error('That video cannot be played here.');
				var addedAt = {};
				addedAt[best.videoId] = new Date().toISOString();
				if (!lib.playlists[DISCOVERED]) L.setPlaylist(lib, { id: DISCOVERED, title: 'Discovered', privacy: 'local', special: 'local', importedAt: new Date().toISOString() });
				L.upsert(lib, res.videos, { playlistId: DISCOVERED, addedAt: addedAt, now: Date.now() });
				var tr = lib.tracks[best.videoId];
				if (!t._video) tr.labels = { artist: t.artist, title: t.title };
				L.deriveIds(lib, [tr.id]);
				lib.playlists[DISCOVERED].count = L.list(lib).filter(function (x) { return x.playlists.indexOf(DISCOVERED) >= 0; }).length;
				return Promise.all([store.putTracks([tr]), store.putPlaylists([lib.playlists[DISCOVERED]]), saveMeta()]).then(function () { dirty(); return tr.id; });
			});
		}).then(function (id) {
			if (btn) btn.disabled = false;
			playIds([id], 0, { label: 'Discover', href: location.hash });
			say('Playing ' + q(t.title) + ' by ' + t.artist + '. It is kept under the playlist Discovered.');
		}).catch(function (err) { if (btn) btn.disabled = false; onApiError(err); });
	}
	function hideArtist(name) {
		loadHidden().then(function (hd) { hd[DX.norm(name)] = true; if (!thumb) store.set('discover:hidden', hd); if (route.parts[0] === 'discover' || route.parts[0] === 'artist') renderView(true); say(name + ' will not be suggested again.'); });
	}
	function viewDiscover(view, parts, query) {
		if (!dzIds) { view.appendChild(h('p', { class: 'ts-muted', text: 'Loading' + ELL })); var hh = location.hash; loadDiscoverState().then(function () { if (location.hash === hh) renderView(true); }, function (e) { if (location.hash === hh) { clear(view); view.appendChild(h('p', { class: 'ts-muted', text: 'Discover could not start: ' + (e && e.message || e) })); } }); return; }
		if (query.get('dz')) { viewDzArtist(view, query.get('dz')); return; }
		if (!query.get('seed') && !query.get('artist')) { viewDiscoverHub(view); return; }
		view.appendChild(h('a', { class: 'ts-back', href: '#/discover', text: String.fromCharCode(0x2190) + ' Discover' }));
		viewDiscoverSeed(view, parts, query);
	}
	function viewDiscoverSeed(view, parts, query) {
		var seedT = lib.tracks[query.get('seed') || ''] || null, seedKey = query.get('artist') || '';
		if (!seedT && !seedKey && ctl && ctl.current()) seedT = lib.tracks[ctl.current()];
		if (!seedKey && seedT) seedKey = seedT.artistKey;
		var ix = idx(), a = seedKey && ix.artists[seedKey];
		if (!a) {
			view.appendChild(h('h1', { class: 'ts-h1', text: 'Discover' }));
			view.appendChild(h('p', { class: 'ts-muted ts-lede', text: seedT ? 'This song has no sure artist yet, so there is nothing to start from. Name its artist, or start from one of these:' : 'Find songs you do not have yet, like an artist you love. Start from what is playing, or pick an artist:' }));
			var top = Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).sort(function (x, y) { return (y.plays * 3 + y.tracks.length) - (x.plays * 3 + x.tracks.length); }).slice(0, 30);
			var row = h('div', { class: 'ts-chips' });
			top.forEach(function (x) { row.appendChild(h('a', { class: 'ts-chip', href: '#/discover?artist=' + encodeURIComponent(x.key), text: x.name })); });
			view.appendChild(row);
			return;
		}
		var hue = familyHue(a.family);
		headerBlock(view, {
			kicker: 'Discover', title: seedT ? 'Like ' + trackTitle(seedT) : 'Like ' + a.name, alt: seedT ? 'by ' + a.name : '', hue: hue,
			artNode: seedT ? artFor(seedT, 'ts-hero-art') : (a.cover && prefs.art && !demo ? U.art(a.cover.id, hue.h, a.name, 'ts-hero-art is-round', true, hue.s) : null),
			blurb: 'Artists like ' + a.name + ' and their best songs, from Deezer. Preview 30 seconds here; Play finds the song on YouTube' + (auth.signedIn() ? ' (100 quota units a search) and keeps it in the playlist Discovered.' : ' (sign in to play it here; otherwise YouTube opens in a new tab).'),
			actions: [
				actionBtn('radio', 'Preview radio like this', function () { dzArtistFor(seedKey).then(function (d) { if (!d) { say('Deezer does not know ' + a.name + '.'); return; } return deezer().radio(d.id, 50).then(function (ts) { pvStart(freshOnly(ts), 0, a.name + ' mix'); }); }); }, true),
				actionBtn('compass', 'Explore ' + a.name + ' on Deezer', function () { dzArtistFor(seedKey).then(function (d) { if (d) location.hash = '#/discover?dz=' + d.id; else say('Deezer does not know ' + a.name + '.'); }); }),
				actionBtn('artist', 'Go to ' + a.name, function () { location.hash = link('artist', seedKey); })
			]
		});
		var status = h('p', { class: 'ts-muted', aria: { live: 'polite' }, text: 'Asking Deezer' + ELL });
		view.appendChild(status);
		var box = h('div');
		view.appendChild(box);
		// deeper in the library: songs like the seed that were barely played
		if (seedT) {
			var deep = radioIds(seedT, 200).slice(1).map(function (id) { return lib.tracks[id]; }).filter(function (t) { return t && t.plays <= 1; }).slice(0, 20);
			if (deep.length) { sectionHead(view, 'Deeper in your library'); view.appendChild(h('p', { class: 'ts-muted', text: 'Songs like this one you have barely heard.' })); trackList(view, deep, { context: { label: 'Deeper: ' + trackTitle(seedT), href: location.hash } }); }
		}
		var ev = artistEvidence(seedKey), here = location.hash;
		loadHidden().then(function (hidden) {
			function attempt(keys, i, tried) {
				if (i >= keys.length) return Promise.resolve({ res: null, from: null, tried: tried });
				var e2 = artistEvidence(keys[i]);
				return DX.suggest(deezer(), { names: e2.names, titles: e2.titles, known: knownArtistName, hidden: hidden, perArtist: 3, artists: 12 }).then(function (res) {
					tried.push(ix.artists[keys[i]] ? ix.artists[keys[i]].name : keys[i]);
					if (res.artist && res.related.length) return { res: res, from: keys[i], tried: tried };
					return attempt(keys, i + 1, tried);
				});
			}
			return attempt([seedKey].concat(nearArtists(seedKey, 3)), 0, []);
		}).then(function (out) {
			if (location.hash !== here) return;
			clear(box);
			if (!out.res) { status.textContent = 'Deezer does not know ' + a.name + ' or the artists closest to them (' + out.tried.slice(1).join(', ') + '). ' + (auth.signedIn() ? 'Search YouTube below instead.' : ''); ytSearchBox(view, a, seedT); return; }
			var via = out.from !== seedKey ? ' Deezer did not know ' + a.name + ', so these start from ' + (ix.artists[out.from] || {}).name + ', which sounds closest in your library.' : '';
			status.textContent = plural(out.res.related.length, 'artist') + ' like ' + (out.from === seedKey ? a.name : (ix.artists[out.from] || {}).name) + (out.res.verified ? '' : ' (Deezer has an artist of that name; it may be another one)') + '.' + via;
			var newOnes = out.res.related.filter(function (r2) { return !r2.known; }), knownOnes = out.res.related.filter(function (r2) { return r2.known; });
			if (newOnes.length) {
				sectionHead(box, 'Artists you do not have yet');
				shelf(box, newOnes.map(function (r2) {
					var art2 = r2.picture ? (function () { var w = h('span', { class: 'ts-art is-round' }); w.appendChild(h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: r2.picture })); return w; })() : U.swatch(hue.h, r2.name, 'is-round');
					var c = card({ round: true, href: '#discover-' + r2.id, art: art2, title: r2.name, sub: r2.fans ? n(r2.fans) + ' fans on Deezer' : 'On Deezer' });
					c.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); var t0 = box.querySelector('[data-dz-artist="' + r2.id + '"]'); if (t0) { t0.scrollIntoView({ block: 'center' }); var b = t0.querySelector('button'); if (b) b.focus(); } });
					return c;
				}));
			}
			sectionHead(box, 'Songs to try');
			var list = h('ul', { class: 'ts-dlist' });
			out.res.related.forEach(function (r2) {
				r2.tracks.forEach(function (t, i) {
					var li = h('li', { class: 'ts-drow', data: { dzArtist: i === 0 ? r2.id : null } });
					li.appendChild(t.cover ? (function () { var w = h('span', { class: 'ts-art ts-q-art' }); w.appendChild(h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: t.cover })); return w; })() : U.swatch(hue.h, t.title, 'ts-q-art'));
					var tx = h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: t.title + (t.version ? ' ' + t.version : '') }), h('span', { class: 'ts-q-artist', text: t.artist + (t.album ? ' ' + DOT + ' ' + t.album : '') })]);
					li.appendChild(tx);
					if (!r2.known) li.appendChild(h('span', { class: 'ts-tag', text: 'New artist' }));
					var pv = U.iconBtn('play', 'Preview ' + t.title, { cls: 'ts-pv', on: { click: function () { preview(t, pv); } } });
					pv.disabled = !t.preview;
					li.appendChild(pv);
					li.appendChild(h('button', { class: 'kit-btn small', text: auth.signedIn() ? 'Play' : 'YouTube', title: auth.signedIn() ? 'Find it on YouTube and play it here (100 quota units)' : 'Search YouTube in a new tab', on: { click: function (e) { playFound(t, e.currentTarget); } } }));
					var ab2 = addButton(t);
					if (ab2) li.appendChild(ab2);
					if (i === 0) li.appendChild(U.iconBtn('close', 'Not interested in ' + r2.name, { on: { click: function () { hideArtist(r2.name); } } }));
					list.appendChild(li);
				});
			});
			box.appendChild(list);
			if (knownOnes.length) box.appendChild(h('p', { class: 'ts-muted', text: 'Also related, already in your library: ' + knownOnes.map(function (r2) { return r2.name; }).join(', ') + '.' }));
			box.appendChild(h('p', { class: 'ts-legal', text: 'Artist pictures, previews and suggestions from Deezer. The lookup runs in a sandboxed frame that cannot see this page or your sign-in.' }));
			ytSearchBox(view, a, seedT);
		}).catch(function (err) { if (location.hash === here) { status.textContent = 'Discovery did not work: ' + (err && err.message || err); ytSearchBox(view, a, seedT); } });
	}
	// A YouTube search for more, from the labels (signed in only).
	function ytSearchBox(view, a, seedT) {
		if (demo || !auth.signedIn() || view.querySelector('.ts-ytsearch')) return;
		var guess = seedT ? [seedT.work && seedT.role ? seedT.work + ' ' + seedT.role : '', seedT.genres[0] || '', T.LANG_NAME[seedT.lang] || ''].filter(Boolean).join(' ') : a.name + ' similar';
		var sec = h('section', { class: 'ts-ytsearch' });
		sec.appendChild(h('h2', { class: 'ts-sec-head', text: 'Search YouTube for more' }));
		var f = h('form', { class: 'ts-inline-form' });
		var inp = h('input', { class: 'kit-input', type: 'search', value: guess, aria: { label: 'YouTube search' } });
		f.appendChild(inp);
		f.appendChild(h('button', { class: 'kit-btn', type: 'submit', text: 'Search (100 quota units)' }));
		var res = h('ul', { class: 'ts-dlist' });
		f.addEventListener('submit', function (e) {
			e.preventDefault();
			clear(res);
			client.search(inp.value, { max: 12 }).then(function (items) {
				items.filter(function (it) { return !lib.tracks[it.videoId]; }).forEach(function (it) {
					var li = h('li', { class: 'ts-drow' });
					if (prefs.art) li.appendChild(U.art(it.videoId, 210, it.title, 'ts-q-art', true));
					li.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: it.title }), h('span', { class: 'ts-q-artist', text: it.channel })]));
					li.appendChild(h('button', { class: 'kit-btn small', text: 'Play', on: { click: function (ev) { playFound({ id: it.videoId, artist: it.channel.replace(/ - Topic$/, ''), title: it.title, _video: it }, ev.currentTarget); } } }));
					var ab3 = addButton({ id: it.videoId, artist: it.channel.replace(/ - Topic$/, ''), title: it.title, _video: it });
					if (ab3) li.appendChild(ab3);
					res.appendChild(li);
				});
				if (!res.firstChild) res.appendChild(h('li', { class: 'ts-muted', text: 'Nothing new: everything found is already in your library.' }));
			}).catch(onApiError);
		});
		sec.appendChild(f);
		sec.appendChild(res);
		view.appendChild(sec);
	}

	// ---- The now-playing panel's width ---------------------------------------------------------------
	// A handle on its left edge; the width is kept for this browser.

	var NOW_MIN = 280;
	function nowMax() { return Math.max(NOW_MIN, Math.min(1100, window.innerWidth - 480)); }
	function setNowWidth(w, save) {
		var root = document.documentElement;
		if (w == null) { root.style.removeProperty('--ts-now'); if (save) ToyKit.store('nowWidth', null); }
		else { w = Math.round(Math.max(NOW_MIN, Math.min(nowMax(), w))); root.style.setProperty('--ts-now', w + 'px'); if (save) ToyKit.store('nowWidth', w); }
		var hd = $('now-resizer'), cur = $('now').getBoundingClientRect().width;
		if (hd) { hd.setAttribute('aria-valuenow', String(Math.round(cur))); hd.setAttribute('aria-valuemin', String(NOW_MIN)); hd.setAttribute('aria-valuemax', String(Math.round(nowMax()))); }
		if (mapRedraw) mapRedraw();
		if (typeof renderVbar === 'function') renderVbar();
	}
	function wireResizer() {
		var hd = $('now-resizer'), saved = thumb ? null : ToyKit.load('nowWidth', null);
		if (saved) setNowWidth(+saved, false);
		if (!hd) return;
		var drag = null;
		hd.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			hd.setPointerCapture(e.pointerId);
			drag = { x: e.clientX, w: $('now').getBoundingClientRect().width };
			document.body.classList.add('is-resizing');
		});
		hd.addEventListener('pointermove', function (e) { if (drag) setNowWidth(drag.w + (drag.x - e.clientX), false); });
		function end() { if (!drag) return; drag = null; document.body.classList.remove('is-resizing'); setNowWidth($('now').getBoundingClientRect().width, true); }
		hd.addEventListener('pointerup', end);
		hd.addEventListener('pointercancel', end);
		hd.addEventListener('dblclick', function () { setNowWidth(null, true); say('The panel is back to its usual width.'); });
		hd.addEventListener('keydown', function (e) {
			var w = $('now').getBoundingClientRect().width, step = e.shiftKey ? 80 : 20;
			if (e.key === 'ArrowLeft') setNowWidth(w + step, true);
			else if (e.key === 'ArrowRight') setNowWidth(w - step, true);
			else if (e.key === 'Home') setNowWidth(NOW_MIN, true);
			else if (e.key === 'End') setNowWidth(nowMax(), true);
			else if (e.key === 'Enter' || e.key === 'Escape') { setNowWidth(null, true); }
			else return;
			e.preventDefault();
			e.stopPropagation();
		});
		window.addEventListener('resize', later(function () { var s2 = ToyKit.load('nowWidth', null); if (s2) setNowWidth(+s2, false); }, 150));
	}

	// ---- Choosing how to shuffle: the mode, everywhere ---------------------------------------------
	// The order mode is the heart of the page, so it is a labelled control in
	// the player bar, in the queue and on every Shuffle button.

	function modeLabel() { return queueMode === 'list' ? 'In list order' : modeName(plan.mode); }
	function fillModePill(b) {
		clear(b);
		b.appendChild(icon(queueMode === 'list' ? 'list' : modeIcon(plan.mode)));
		b.appendChild(h('span', { class: 'ts-modepill-label', text: modeLabel() }));
		b.appendChild(icon('down', 'ts-modepill-caret'));
		b.setAttribute('aria-label', 'How the next songs are chosen: ' + modeLabel() + '. Change');
	}
	function renderModePill() { fillModePill($('btn-mode')); }
	// The menu of orders, each with what it does, and the two shuffle options.
	// onPick(key): what choosing does (default: the current queue from the next song on).
	function modeMenu(anchor, onPick, opts) {
		opts = opts || {};
		var items = [{ heading: opts.heading || 'Choose how the next songs are picked' }];
		ORDER.forEach(function (o) {
			items.push({ label: modeName(o.key), desc: modeInfo(o.key).blurb, icon: o.icon, checked: opts.noCheck ? null : (queueMode !== 'list' && plan.mode === o.key), onSelect: function () { (onPick || setMode)(o.key); } });
		});
		items.push({ sep: true });
		items.push({ label: 'Keep songs of one anime or game apart', icon: 'works', checked: plan.apart !== false, onSelect: function () { plan.apart = plan.apart === false; applyPlan({ say: plan.apart ? 'Songs of one work are kept apart.' : 'Songs of one work may play back to back.' }); } });
		items.push({ label: 'One version of each song', icon: 'disc', checked: !!plan.oneVersion, onSelect: function () { plan.oneVersion = !plan.oneVersion; applyPlan({ say: plan.oneVersion ? 'One version of each song from now on.' : 'Every version may play.' }); } });
		items.push({ label: 'Mix builder' + ELL, icon: 'mix', onSelect: function () { location.hash = '#/mix'; } });
		U.openMenu(anchor, items, { label: 'Shuffle order', focusChecked: true });
	}
	// A Shuffle button with the order next to it: the main part shuffles in the
	// current order, the caret picks another order and shuffles with it.
	function shuffleSplit(patch, ctx) {
		var g = h('div', { class: 'ts-split', role: 'group', aria: { label: 'Shuffle' } });
		var main = h('button', { class: 'ts-icon-btn ts-act ts-split-main', title: 'Shuffle these: ' + modeName(plan.mode === 'original' ? 'true' : plan.mode) }, [icon(modeIcon(plan.mode === 'original' ? 'true' : plan.mode)), h('span', { text: 'Shuffle' }), h('span', { class: 'ts-split-mode', text: modeName(plan.mode === 'original' ? 'true' : plan.mode) })]);
		main.addEventListener('click', function () { shuffleThese(patch, ctx); });
		var caret = h('button', { class: 'ts-icon-btn ts-act ts-split-caret', aria: { label: 'Shuffle these another way', haspopup: 'menu' }, title: 'Choose how to shuffle' }, icon('down'));
		caret.addEventListener('click', function () { modeMenu(caret, function (key) { shuffleThese(patch, ctx, key); }, { heading: 'Shuffle these with' }); });
		g.appendChild(main);
		g.appendChild(caret);
		return g;
	}
	// Under "Playing from": the order, the time left, shuffle again.
	function renderQueueExtras(up) {
		var box = $('queue-mode');
		if (!box || !ctl) return;
		clear(box);
		var st = ctl.state();
		if (!st.items.length) return;
		var pill = h('button', { class: 'ts-modepill is-small', aria: { haspopup: 'menu' } });
		fillModePill(pill);
		pill.addEventListener('click', function () { modeMenu(pill); });
		box.appendChild(pill);
		var secs2 = 0;
		up.forEach(function (id) { secs2 += (lib.tracks[id] && lib.tracks[id].durationSec) || 0; });
		box.appendChild(h('span', { class: 'ts-muted', text: queueMode === 'true' ? 'endless' : plural(up.length, 'song') + (secs2 ? ' ' + DOT + ' ' + longTime(secs2) + ' left' : '') }));
		box.appendChild(U.iconBtn('shuffle', 'Shuffle what comes next again', { on: { click: reshuffle } }));
	}

	// ---- The player's size: presets, theater, full screen ---------------------------------------------

	var SIZES = [['S', 340], ['M', 520], ['L', 760]];
	var theaterPrev = null;
	function renderVbar() {
		var bar = $('vbar');
		if (!bar) return;
		clear(bar);
		var w = Math.round($('now').getBoundingClientRect().width), th = document.body.classList.contains('is-theater');
		SIZES.forEach(function (s2) {
			var on = !th && Math.abs(w - Math.min(nowMax(), s2[1])) < 6;
			bar.appendChild(h('button', { class: 'ts-vbtn' + (on ? ' is-on' : ''), text: s2[0], aria: { pressed: on ? 'true' : 'false', label: 'Player size ' + s2[0] }, title: (s2[0] === 'S' ? 'Small' : s2[0] === 'M' ? 'Medium' : 'Large') + ' player', on: { click: function () { setTheater(false); setNowWidth(s2[1], true); renderVbar(); } } }));
		});
		var tb = h('button', { class: 'ts-vbtn' + (th ? ' is-on' : ''), aria: { pressed: th ? 'true' : 'false', label: 'Theater mode' }, title: 'Theater mode: a big video (t)', on: { click: function () { setTheater(!document.body.classList.contains('is-theater')); } } }, icon('theater'));
		bar.appendChild(tb);
		bar.appendChild(h('button', { class: 'ts-vbtn', aria: { label: 'Full screen' }, title: 'Full screen (f)', on: { click: toggleFullscreen } }, icon('fullscreen')));
	}
	function setTheater(on) {
		var b = document.body, was = b.classList.contains('is-theater');
		if (on === was) return;
		if (on) { theaterPrev = ToyKit.load('nowWidth', null); b.classList.add('is-theater'); setNowWidth(Math.max(520, window.innerWidth - 68 - 640), false); }
		else { b.classList.remove('is-theater'); setNowWidth(theaterPrev ? +theaterPrev : null, false); }
		var tb = $('btn-theater');
		if (tb) { tb.setAttribute('aria-pressed', on ? 'true' : 'false'); tb.classList.toggle('is-on', on); }
		renderVbar();
	}
	function toggleFullscreen() {
		var v = $('video');
		if (document.fullscreenElement) { document.exitFullscreen(); return; }
		if (!player || player.state() === 'idle') { say('Start a song first.'); return; }
		if (v.requestFullscreen) v.requestFullscreen().catch(function () { say('Full screen is not allowed here; YouTube\u2019s own full-screen button works too.'); });
	}

	// ---- Volume and like ------------------------------------------------------------------------------------

	function renderVolume() {
		var v = player ? player.volume() : 100, m = player ? player.muted() : false, r = $('vol');
		if (!r) return;
		r.value = m ? 0 : v;
		r.style.setProperty('--p', (m ? 0 : v) + '%');
		var b = $('btn-mute');
		U.setIcon(b, m || v === 0 ? 'mute' : 'volume');
		b.setAttribute('aria-pressed', m ? 'true' : 'false');
		b.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
	}
	function setVolume(v) {
		v = Math.max(0, Math.min(100, Math.round(v)));
		player.volume(v);
		if (v > 0 && player.muted()) player.muted(false);
		ToyKit.store('volume', v);
		ToyKit.store('muted', false);
		renderVolume();
	}
	function toggleMute() { var m = !player.muted(); player.muted(m); ToyKit.store('muted', m); renderVolume(); say(m ? 'Muted.' : 'Sound on.'); }
	function liked(t) { return !!t && (t.rating || 0) >= 4; }
	function toggleLike(t) {
		if (!t) return;
		var was = t.rating || 0, on = !liked(t);
		L.edit(lib, t.id, { rating: on ? 5 : 0 });
		changed([t.id]);
		U.toast(on ? 'Added to Liked songs.' : 'Removed from Liked songs.', { action: 'Undo', onAction: function () { L.edit(lib, t.id, { rating: was }); changed([t.id]); } });
	}
	function likeButton(t, cls) {
		var on = liked(t);
		var b = h('button', { class: 'ts-icon-btn ts-like' + (on ? ' is-on' : '') + (cls ? ' ' + cls : ''), aria: { pressed: on ? 'true' : 'false', label: (on ? 'Unlike ' : 'Like ') + trackTitle(t) }, title: on ? 'Liked' : 'Like' }, icon('heart'));
		b.addEventListener('click', function (e) { e.stopPropagation(); toggleLike(t); });
		return b;
	}
	function renderLike() {
		var b = $('btn-like'), t = ctl && ctl.current() && lib.tracks[ctl.current()];
		if (!b) return;
		b.disabled = !t;
		U.setIcon(b, 'heart');
		var on = liked(t);
		b.classList.toggle('is-on', on);
		b.setAttribute('aria-pressed', on ? 'true' : 'false');
		b.setAttribute('aria-label', on ? 'Remove from Liked songs' : 'Add to Liked songs');
	}
	function viewLiked(view) {
		var ts = idx().all.filter(function (t) { return liked(t); });
		collection(view, { kicker: 'Playlist', title: 'Liked songs', blurb: ts.length ? 'Every song you rated four stars or more, or liked with the heart.' : 'Press the heart on any song (or L while it plays) and it lands here.', hue: { h: 340, s: 60 }, tracks: ts, ctx: { label: 'Liked songs', href: '#/liked', patch: { minRating: 4 } }, sort: 'added', breakdown: 'family' });
	}

	// ---- The seek bar: the time under the pointer ----------------------------------------------------------

	function wireSeekTip() {
		var box = $('seekbox'), r = $('seek'), tip = $('seektip');
		if (!box || !tip) return;
		r.addEventListener('pointermove', function (e) {
			var rc = r.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - rc.left) / rc.width));
			var tm = player ? player.time() : { duration: 0 }, dur = tm.duration || 0;
			if (!dur || r.disabled) { tip.hidden = true; return; }
			tip.textContent = clock(f * dur);
			tip.style.left = (rc.left - box.getBoundingClientRect().left + f * rc.width) + 'px';
			tip.hidden = false;
		});
		r.addEventListener('pointerleave', function () { tip.hidden = true; });
	}

	// ---- The command palette (Ctrl+K) -----------------------------------------------------------------------
	// Jump to any page, artist, work, genre, mood, scene, year, playlist or song,
	// or run an action, by typing a few letters.

	function paletteEntries(qtext) {
		var f = Parse.fold(qtext.trim()), ix = idx(), out = [];
		function score(name) {
			var n2 = Parse.fold(name);
			if (!f) return 1;
			if (n2 === f) return 100;
			if (n2.indexOf(f) === 0) return 60;
			if ((' ' + n2).indexOf(' ' + f) >= 0) return 40;
			if (n2.indexOf(f) >= 0) return 20;
			var i = 0;
			for (var k = 0; k < n2.length && i < f.length; k++) if (n2[k] === f[i]) i++;
			return i === f.length && f.length > 2 ? 5 : 0;
		}
		function add(kind, name, sub, run, iconName, weight) { var s2 = score(name); if (s2 > 0) out.push({ kind: kind, name: name, sub: sub, run: run, icon: iconName, s: s2 + (weight || 0) }); }
		ACTIONS().forEach(function (a2) { add('Action', a2[0], a2[1], a2[2], a2[3], 8); });
		NAV.forEach(function (it) { if (!it.sep) add('Page', it.label, '', function () { location.hash = '#/' + it.key; }, it.icon, 6); });
		add('Page', 'Liked songs', '', function () { location.hash = '#/liked'; }, 'heart', 6);
		if (!f) return out.sort(function (a2, b2) { return b2.s - a2.s; }).slice(0, 14);
		lists.forEach(function (li) { add('Playlist', li.name, li.kind === 'smart' ? 'smart' : 'hand-picked', function () { location.hash = link('list', li.id); }, 'list', 4); });
		Object.keys(ix.artists).forEach(function (k) { var a2 = ix.artists[k]; add('Artist', a2.name + (a2.native ? ' ' + a2.native : ''), plural(a2.tracks.length, 'song'), function () { location.hash = link('artist', k); }, 'artist', 3); });
		Object.keys(ix.works).forEach(function (w) { add('From', w, plural(ix.works[w].tracks.length, 'song'), function () { location.hash = link('work', w); }, 'works', 3); });
		Object.keys(ix.genres).forEach(function (g) { add('Genre', g, plural(ix.genres[g].tracks.length, 'song'), function () { location.hash = link('genre', g); }, 'genre', 2); });
		T.MOODS.forEach(function (m) { add('Mood', m[1], m[2], function () { location.hash = link('c', 'mood', m[0]); }, 'mood', 2); });
		T.SCENES.forEach(function (s2) { add('Scene', s2[1], '', function () { location.hash = link('c', 'scene', s2[0]); }, 'works', 2); });
		Object.keys(ix.addedY).forEach(function (y) { add('Added', 'Added in ' + y, plural(ix.addedY[y].tracks.length, 'song'), function () { location.hash = link('c', 'added', y); }, 'newest', 1); });
		L.search(lib, qtext, scopeTracks()).slice(0, 8).forEach(function (t) { out.push({ kind: 'Song', name: trackTitle(t), sub: trackArtist(t), run: function () { playIds([t.id], 0, { label: trackTitle(t), href: link('track', t.id) }); }, art: t, s: 15 }); });
		return out.sort(function (a2, b2) { return b2.s - a2.s; }).slice(0, 14);
	}
	function ACTIONS() {
		return [
			['Shuffle everything', 'in the current order', function () { shuffleThese({}, { label: 'Everything', href: '#/songs' }); }, 'shuffle'],
			['Change the shuffle order', modeLabel(), function () { modeMenu($('btn-mode')); }, 'shuffle'],
			['Play or pause', 'Space', togglePlay, 'play'],
			['Next song', 'N', goNext, 'next'],
			['Theater mode', 'T', function () { setTheater(!document.body.classList.contains('is-theater')); }, 'theater'],
			['Full screen', 'F', toggleFullscreen, 'fullscreen'],
			['Like the playing song', 'L', function () { toggleLike(ctl && lib.tracks[ctl.current()]); }, 'heart'],
			['Mute or unmute', 'M', toggleMute, 'volume'],
			['Start radio from the playing song', '', function () { var t = ctl && lib.tracks[ctl.current()]; if (t) startRadio(t); }, 'radio'],
			['Discover songs like the playing one', '', function () { var t = ctl && ctl.current(); location.hash = '#/discover' + (t ? '?seed=' + encodeURIComponent(t) : ''); }, 'compass'],
			['Leave focus', focus ? listById(focus) && listById(focus).name : 'not focused', function () { setFocus(null); }, 'close'],
			['Save the queue as a playlist', '', saveQueueAsList, 'plus'],
			['Keyboard shortcuts', '?', showShortcuts, 'keyboard'],
			['Switch light or dark', '', function () { ToyKit.setTheme(ToyKit.theme() === 'dark' ? 'light' : 'dark'); }, 'mood']
		];
	}
	function openPalette() {
		if (U.dialogOpen()) return;
		var d = U.openDialog({ title: 'Go to or do anything' });
		d.node.classList.add('ts-palette');
		var inp = h('input', { class: 'kit-input ts-palette-in', type: 'search', placeholder: 'Artist, anime, genre, mood, playlist, song or action', autocomplete: 'off', spellcheck: 'false', aria: { label: 'Search everything', controls: 'ts-pal-list' } });
		var ul = h('ul', { class: 'ts-pal-list', id: 'ts-pal-list', role: 'listbox' });
		d.body.appendChild(inp);
		d.body.appendChild(ul);
		var items = [], at = 0;
		function draw() {
			items = paletteEntries(inp.value);
			at = Math.min(at, Math.max(0, items.length - 1));
			clear(ul);
			items.forEach(function (it, i) {
				var li = h('li', { class: 'ts-pal-item' + (i === at ? ' is-on' : ''), role: 'option', aria: { selected: i === at ? 'true' : 'false' } });
				li.appendChild(it.art ? artFor(it.art, 'ts-pal-art') : h('span', { class: 'ts-pal-ic' }, icon(it.icon || 'disc')));
				li.appendChild(h('span', { class: 'ts-pal-text' }, [h('b', { text: it.name }), it.sub ? h('span', { text: it.sub }) : null]));
				li.appendChild(h('span', { class: 'ts-pal-kind', text: it.kind }));
				li.addEventListener('click', function () { run(i); });
				li.addEventListener('pointermove', function () { if (at !== i) { at = i; mark(); } });
				ul.appendChild(li);
			});
			if (!items.length) ul.appendChild(h('li', { class: 'ts-muted ts-pal-none', text: 'Nothing matches.' }));
		}
		function mark() { Array.prototype.forEach.call(ul.children, function (c, i) { c.classList.toggle('is-on', i === at); c.setAttribute('aria-selected', i === at ? 'true' : 'false'); }); var c2 = ul.children[at]; if (c2 && c2.scrollIntoView) c2.scrollIntoView({ block: 'nearest' }); }
		function run(i) { var it = items[i]; if (!it) return; d.close(); it.run(); }
		inp.addEventListener('input', function () { at = 0; draw(); });
		inp.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(items.length - 1, at + 1); mark(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); mark(); }
			else if (e.key === 'Enter') { e.preventDefault(); run(at); }
		});
		draw();
		inp.focus();
	}
	function showShortcuts() {
		var d = U.openDialog({ title: 'Keyboard shortcuts', wide: true });
		var rows = [['Ctrl+K', 'Go to or do anything'], ['Space', 'Play or pause'], ['N / P', 'Next / previous song'], ['S', 'Shuffle what comes next again'], ['O', 'Choose the shuffle order'], ['R', 'Repeat the queue'], ['L', 'Like the playing song'], ['M', 'Mute'], ['- / =', 'Volume down / up'], ['\u2190 / \u2192', 'Ten seconds back / on'], ['T', 'Theater mode'], ['F', 'Full screen'], ['Q', 'Show the queue'], ['E', 'Edit the playing song'], ['/', 'Search'], ['?', 'This list'], ['In a list', '\u2191 \u2193 move, Enter play, Space select, E edit, Shift+F10 menu, Ctrl+A all'], ['Quick labeller', '1\u20136 mood, Enter save, \u2190 \u2192 back and skip, P play']];
		var tbl = h('table', { class: 'ts-keys' });
		rows.forEach(function (r) { tbl.appendChild(h('tr', null, [h('th', null, h('kbd', { text: r[0] })), h('td', { text: r[1] })])); });
		d.body.appendChild(tbl);
	}
	function saveQueueAsList() {
		if (!ctl) return;
		var st = ctl.state(), ids = st.items.slice(Math.max(0, st.index));
		if (!ids.length) { say('The queue is empty.'); return; }
		createList('manual', { ids: ids }, 'Queue ' + new Date().toISOString().slice(0, 10), { focus: false });
	}

	// ---- A compact header that stays while a long page scrolls ------------------------------------------
	function stickyHeader(view, title, actionsRow) {
		if (!actionsRow || !window.IntersectionObserver) return;
		var bar = h('div', { class: 'ts-sticky', aria: { hidden: 'true' } });
		var play = actionsRow.querySelector('.ts-act.is-primary');
		if (play) bar.appendChild(h('button', { class: 'ts-sticky-play', tabindex: '-1', aria: { label: 'Play' }, on: { click: function () { play.click(); } } }, icon('play')));
		bar.appendChild(h('b', { text: title }));
		view.insertBefore(bar, view.firstChild);
		var io = new IntersectionObserver(function (es) { es.forEach(function (e) { bar.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top < 0); }); }, { root: $('main'), threshold: 0 });
		io.observe(actionsRow);
	}

	// ---- Drop a labels file (or a backup) anywhere on the page ---------------------------------------
	function wireFileDrop() {
		if (demo) return;
		function isFile(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
		document.addEventListener('dragover', function (e) { if (isFile(e)) { e.preventDefault(); document.body.classList.add('is-filedrop'); } });
		document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('is-filedrop'); });
		document.addEventListener('drop', function (e) {
			document.body.classList.remove('is-filedrop');
			if (!isFile(e)) return;
			e.preventDefault();
			var f = e.dataTransfer.files[0];
			if (!f || f.name.toLowerCase().slice(-5) !== '.json') { say('Drop a .json labels file or backup.'); return; }
			readJson(f).then(function (data) {
				if (data && data.format === L.LABELS_FORMAT) { applyLabelsFile(f); return; }
				if (data && data.format === 'true-shuffle-export') {
					var d = U.openDialog({ title: 'Restore this backup?' });
					d.body.appendChild(h('p', { text: 'It replaces everything stored here (library, labels, ratings, plays, playlists) with ' + q(f.name) + '.' }));
					d.body.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'kit-btn primary', text: 'Restore', on: { click: function () { d.close(); importFile(f); } } }), h('button', { class: 'kit-btn', text: 'Cancel', on: { click: d.close } })]));
					return;
				}
				say('That file is not a labels file or a True Shuffle backup.');
			}).catch(fail);
		});
	}

	// ---- Density -------------------------------------------------------------------------------------------
	function applyDensity() { document.body.classList.toggle('is-compact', prefs.density === 'compact'); }

	// ---- Discover, the hub -------------------------------------------------------------------------------
	// Many ways in: artists like the ones you play most, new releases from
	// artists you have, more songs by them you don't have, picks from
	// playlists of your genres, any artist on Deezer, a preview radio, and a
	// list of songs saved for later.

	var dzIds = null, dzSaved = null, dzRecent = null;
	function kvGet(key, fb) { return thumb || !store ? Promise.resolve(fb) : store.get(key, fb); }
	function kvSet(key, v) { if (!thumb && store) store.set(key, v); }
	function loadDiscoverState() {
		if (dzIds) return Promise.resolve();
		return Promise.all([kvGet('discover:ids', {}), kvGet('discover:saved', []), kvGet('discover:recent', []), loadHidden()]).then(function (r) { dzIds = r[0] || {}; delete dzIds['undefined']; dzSaved = r[1] || []; dzRecent = r[2] || []; });
	}
	// Run fn over items, n at a time.
	function pool(items, n, fn) {
		var i = 0, out = new Array(items.length);
		function worker() { if (i >= items.length) return Promise.resolve(); var k = i++; return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(worker); }
		var ws = [];
		for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
		return Promise.all(ws).then(function () { return out; });
	}
	// The Deezer artist for a library artist, remembered.
	function dzArtistFor(key) {
		if (dzIds[key] !== undefined) return Promise.resolve(dzIds[key]);
		var ev = artistEvidence(key);
		return DX.findArtist(deezer(), ev.names, ev.titles).then(function (f) {
			dzIds[key] = f && f.verified ? { id: f.artist.id, name: f.artist.name, picture: DX.img(f.artist.picture_medium) } : null;
			kvSet('discover:ids', dzIds);
			return dzIds[key];
		});
	}
	// Is a Deezer song already in the library? By artist and title, any spelling the labels know.
	var libSongs = null, libSongsFor = null;
	function inLibrary(t) {
		var m = idx();
		if (libSongsFor !== m || !libSongs) {
			libSongs = {};
			L.list(lib).forEach(function (x) {
				var g = x.guess || {}, as = [x.artist, x.artistNative, x.origArtist, x.artistGuess, g.artist, g.title].filter(Boolean).map(DX.norm), ts2 = [x.title, x.titleAlt, g.title, g.artist].filter(Boolean).map(DX.norm);
				ts2.forEach(function (tt) { libSongs['*|' + tt] = true; as.forEach(function (aa) { libSongs[aa + '|' + tt] = true; }); });
			});
			libSongsFor = m;
		}
		var tt = DX.norm(t.title);
		return !!(libSongs[DX.norm(t.artist) + '|' + tt] || (tt.length > 5 && libSongs['*|' + tt] && knownArtistName(t.artist)));
	}
	function freshOnly(tracks) {
		var seen = {};
		return tracks.filter(function (t) {
			if (!t || !t.preview || inLibrary(t) || (discoverHidden && discoverHidden[DX.norm(t.artist)])) return false;
			var k = DX.norm(t.artist) + '|' + DX.norm(t.title);
			if (seen[k]) return false;
			seen[k] = true;
			return true;
		});
	}
	function topSeeds(n) {
		var ix = idx();
		return Object.keys(ix.artists).map(function (k) {
			var a = ix.artists[k], likes = a.tracks.filter(liked).length;
			return { key: k, a: a, s: a.plays * 3 + likes * 5 + a.tracks.length + (ix.artists[k].scene === 'vtuber' ? -2 : 0) };
		}).filter(function (x) { return x.a.tracks.length >= 2 || x.a.plays; }).sort(function (x, y) { return y.s - x.s; }).slice(0, n);
	}
	function isSaved(t) { return dzSaved.some(function (s2) { return s2.id === t.id; }); }
	function toggleSaved(t, btn) {
		var was = isSaved(t);
		if (was) dzSaved = dzSaved.filter(function (s2) { return s2.id !== t.id; });
		else dzSaved.unshift({ id: t.id, title: t.title, artist: t.artist, artistId: t.artistId, preview: t.preview, cover: t.cover, album: t.album, savedAt: Date.now() });
		kvSet('discover:saved', dzSaved);
		if (btn) { btn.classList.toggle('is-on', !was); btn.setAttribute('aria-pressed', was ? 'false' : 'true'); }
		U.toast(was ? 'Removed from Saved for later.' : 'Saved for later: ' + t.title + '.', { action: 'Undo', onAction: function () { toggleSaved(t, btn); } });
	}
	function remember(seed) {
		dzRecent = [seed].concat((dzRecent || []).filter(function (r) { return r.id !== seed.id; })).slice(0, 12);
		kvSet('discover:recent', dzRecent);
	}
	function dzImg(src, cls, name, round) {
		if (!src) return U.swatch(200, name, cls + (round ? ' is-round' : ''));
		var w = h('span', { class: 'ts-art ' + (cls || '') + (round ? ' is-round' : '') });
		w.appendChild(h('img', { alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: src }));
		return w;
	}
	// One Deezer song: preview, save, play on YouTube, not interested.
	function dzRow(t, list) {
		var li = h('li', { class: 'ts-drow' });
		li.appendChild(dzImg(t.cover, 'ts-q-art', t.title));
		var who = t.artistId ? h('a', { href: '#/discover?dz=' + t.artistId, text: t.artist }) : h('span', { text: t.artist });
		li.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: t.title + (t.version ? ' ' + t.version : '') }), h('span', { class: 'ts-q-artist' }, [who, t.album ? ' ' + DOT + ' ' + t.album : ''])]));
		if (!knownArtistName(t.artist)) li.appendChild(h('span', { class: 'ts-tag', text: 'New artist' }));
		var pv = U.iconBtn('play', 'Preview ' + t.title, { cls: 'ts-pv', on: { click: function () { if (list) pvStart(list, list.indexOf(t), 'Previews'); else preview(t, pv); } } });
		pv.disabled = !t.preview;
		li.appendChild(pv);
		var sv = U.iconBtn('plus', 'Save ' + t.title + ' for later', { cls: 'ts-save' + (isSaved(t) ? ' is-on' : ''), on: { click: function () { toggleSaved(t, sv); } } });
		sv.setAttribute('aria-pressed', isSaved(t) ? 'true' : 'false');
		li.appendChild(sv);
		li.appendChild(h('button', { class: 'kit-btn small', text: auth.signedIn() ? 'Play' : 'YouTube', title: auth.signedIn() ? 'Find it on YouTube and play it here (100 quota units)' : 'Search YouTube in a new tab', on: { click: function (e) { playFound(t, e.currentTarget); } } }));
		var ab = addButton(t);
		if (ab) li.appendChild(ab);
		li.appendChild(U.iconBtn('close', 'Not interested in ' + t.artist, { on: { click: function () { hideArtist(t.artist); li.parentNode && li.parentNode.removeChild(li); } } }));
		return li;
	}
	function dzList(box, tracks, empty) {
		var ul = h('ul', { class: 'ts-dlist' });
		tracks.forEach(function (t) { ul.appendChild(dzRow(t, tracks)); });
		if (!tracks.length && empty) ul.appendChild(h('li', { class: 'ts-muted', text: empty }));
		box.appendChild(ul);
		return ul;
	}
	function dzArtistCard(a) {
		return card({ round: true, href: '#/discover?dz=' + a.id, art: dzImg(a.picture || DX.img(a.picture_medium), '', a.name, true), title: a.name, sub: knownArtistName(a.name) ? 'In your library' : (a.fans || a.nb_fan ? n(a.fans || a.nb_fan) + ' fans' : 'New to you'), play: function () { deezer().radio(a.id, 40).then(function (ts) { pvStart(freshOnly(ts), 0, a.name + ' mix'); }); }, playLabel: 'Preview radio: ' + a.name });
	}
	function albumDialog(album, artistName) {
		var d = U.openDialog({ title: album.title + (artistName ? ' ' + NDASH + ' ' + artistName : ''), wide: true });
		d.body.appendChild(h('p', { class: 'ts-muted', text: (album.type || 'release') + (album.date ? ' ' + DOT + ' ' + album.date : '') }));
		var box = h('div', null, h('p', { class: 'ts-muted', text: 'Loading' + ELL }));
		d.body.appendChild(box);
		deezer().albumTracks(album).then(function (ts) { clear(box); ts.forEach(function (t) { if (!t.artist) t.artist = artistName || ''; }); dzList(box, ts, 'No songs listed.'); }).catch(function (e) { clear(box); box.appendChild(h('p', { class: 'ts-muted', text: e.message })); });
	}
	function albumCard(al, artistName, artistId) {
		var c = card({ href: '#', art: dzImg(al.cover, '', al.title), title: al.title, sub: artistName + ' ' + DOT + ' ' + (al.date || '') + (al.type && al.type !== 'album' ? ' ' + DOT + ' ' + al.type : '') });
		c.querySelector('a').addEventListener('click', function (e) { e.preventDefault(); albumDialog(al, artistName); });
		return c;
	}
	function dsection(view, title, sub) {
		var sec = h('section', { class: 'ts-dsec' });
		var hd = h('div', { class: 'ts-sec-head' }, [h('h2', { text: title })]);
		if (sub) hd.appendChild(h('span', { class: 'ts-muted', text: sub }));
		sec.appendChild(hd);
		var body = h('div', null, h('p', { class: 'ts-muted ts-dloading', text: 'Looking' + ELL }));
		sec.appendChild(body);
		view.appendChild(sec);
		return { sec: sec, head: hd, body: body, done: function () { var l = body.querySelector('.ts-dloading'); if (l) l.parentNode.removeChild(l); } };
	}
	var GENRE_QUERY = { 'Anison pop': 'anime songs', 'Anime rock': 'anime rock', 'Galge song': 'visual novel songs', 'Seiyuu & character song': 'seiyuu', 'Idol pop': 'japanese idol', 'Net-born J-pop': 'j-pop vocaloid producers', 'Mainstream J-pop': 'j-pop hits', 'J-pop rock': 'j-rock', 'Alt J-rock': 'japanese indie rock', 'J-punk & garage': 'japanese punk', 'Psych & art rock (JP)': 'japanese psychedelic', 'City pop': 'city pop', 'Shibuya-kei & neo-acoustic': 'shibuya-kei', 'Showa kayou & 80s idol': 'showa kayokyoku', 'Shoegaze & dream pop': 'shoegaze', 'Indie rock': 'indie rock', 'Vocaloid': 'vocaloid', 'Denpa & kawaii': 'denpa', 'Ethereal & fantasy vocal': 'fantasy anime vocal', 'Touhou arrange': 'touhou arrange', 'Mod & Britpop': 'britpop', 'Post-punk & jangle': 'post-punk' };

	function viewDiscoverHub(view) {
		view.appendChild(h('h1', { class: 'ts-h1', text: 'Discover' }));
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'Songs and artists you do not have yet, from your own taste. Preview 30 seconds of anything; save what you like for later; Play finds it on YouTube.' }));
		// explore any artist
		var f = h('form', { class: 'ts-inline-form ts-dsearch', role: 'search' });
		var inp = h('input', { class: 'kit-input', type: 'search', placeholder: 'Explore any artist (Deezer)', autocomplete: 'off', aria: { label: 'Explore any artist' } });
		f.appendChild(inp);
		var resBox = h('div', { class: 'ts-shelf ts-dsearch-res' });
		f.addEventListener('submit', function (e) { e.preventDefault(); go(); });
		var go = later(function () {
			var v = inp.value.trim();
			clear(resBox);
			if (v.length < 2) return;
			deezer().searchArtists(v).then(function (as) { clear(resBox); as.slice(0, 8).forEach(function (a) { resBox.appendChild(dzArtistCard({ id: a.id, name: a.name, picture: DX.img(a.picture_medium), fans: a.nb_fan })); }); }).catch(function (err) { resBox.appendChild(h('p', { class: 'ts-muted', text: err.message })); });
		}, 350);
		inp.addEventListener('input', go);
		view.appendChild(f);
		view.appendChild(resBox);
		var seedRow = h('div', { class: 'ts-chips ts-chipbar' });
		var cur = ctl && ctl.current() && lib.tracks[ctl.current()];
		if (cur && cur.artistKey) seedRow.appendChild(h('a', { class: 'ts-chip is-hued', style: { '--h': '200', '--s': '55%' }, href: '#/discover?seed=' + encodeURIComponent(cur.id), text: 'Like what is playing: ' + trackTitle(cur) }));
		(dzRecent || []).slice(0, 6).forEach(function (r) { seedRow.appendChild(h('a', { class: 'ts-chip', href: '#/discover?dz=' + r.id, text: r.name })); });
		view.appendChild(seedRow);
		var acts = h('div', { class: 'ts-actions' });
		var radioBtn = actionBtn('radio', 'Preview radio from your taste', function () { tasteRadio(radioBtn); }, true);
		acts.appendChild(radioBtn);
		acts.appendChild(actionBtn('plus', 'Saved for later (' + dzSaved.length + ')', function () { var s2 = view.querySelector('.ts-dsaved'); if (s2) s2.scrollIntoView({ block: 'start' }); }));
		if (lib.playlists[DISCOVERED]) acts.appendChild(actionBtn('list', 'Songs you found here', function () { var li = lists.filter(function (x) { return x.kind === 'smart' && x.patch && x.patch.playlists && x.patch.playlists[0] === DISCOVERED; })[0]; if (!li) { li = { id: newId(), name: 'Discovered', kind: 'smart', patch: { playlists: [DISCOVERED] }, created: new Date().toISOString() }; lists.push(li); saveLists(); } location.hash = link('list', li.id); }));
		view.appendChild(acts);
		var here = location.hash, seeds = topSeeds(14);
		if (!seeds.length) { view.appendChild(h('p', { class: 'ts-empty', text: 'Play or like a few songs first, or label your library, so Discover knows what you like.' })); return; }
		var becauseBox = h('div');
		view.appendChild(becauseBox);
		var newRel = dsection(view, 'New from artists you have', 'releases from the last two years');
		var more = dsection(view, 'More by artists you have', 'their best songs that are not in your library');
		var genres = dsection(view, 'From playlists of your genres');
		var savedSec = h('section', { class: 'ts-dsec ts-dsaved' }, [h('div', { class: 'ts-sec-head' }, [h('h2', { text: 'Saved for later' }), h('span', { class: 'ts-muted', text: plural(dzSaved.length, 'song') })])]);
		view.appendChild(savedSec);
		dzList(savedSec, dzSaved.slice(), 'Press + on any song to keep it here.');
		// find the top artists on Deezer, then fill the sections
		pool(seeds, 4, function (s2) { return dzArtistFor(s2.key).then(function (d) { return d ? { key: s2.key, name: s2.a.name, dz: d } : null; }); }).then(function (found) {
			if (location.hash !== here) return;
			found = found.filter(Boolean);
			if (!found.length) { newRel.done(); newRel.body.appendChild(h('p', { class: 'ts-muted', text: 'Deezer does not know your top artists. Try exploring an artist by name above.' })); return; }
			// because you like X: four of them, related artists you do not have
			found.slice(0, 5).forEach(function (fa) {
				var s3 = dsection(becauseBox, 'Because you like ' + fa.name);
				deezer().related(fa.dz.id).then(function (rel) {
					s3.done();
					var fresh = rel.filter(function (a) { return !knownArtistName(a.name) && !(discoverHidden && discoverHidden[DX.norm(a.name)]); }).slice(0, 14);
					if (!fresh.length) { s3.body.appendChild(h('p', { class: 'ts-muted', text: 'You already have every artist Deezer relates to them.' })); return; }
					s3.head.appendChild(U.iconBtn('radio', 'Preview radio: ' + fa.name, { text: true, cls: 'ts-act', on: { click: function () { deezer().radio(fa.dz.id, 50).then(function (ts) { pvStart(freshOnly(ts), 0, fa.name + ' mix'); }); } } }));
					shelf(s3.body, fresh.map(function (a) { return dzArtistCard({ id: a.id, name: a.name, picture: DX.img(a.picture_medium), fans: a.nb_fan }); }));
				}).catch(function (e) { s3.done(); s3.body.appendChild(h('p', { class: 'ts-muted', text: 'Deezer did not answer (' + (e && e.message || 'error') + '). Reload to try again.' })); });
			});
			// new releases
			var cutoff = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
			pool(found.slice(0, 20), 4, function (fa) { return deezer().albums(fa.dz.id, 30).then(function (als) { return als.filter(function (al) { return al.date >= cutoff; }).slice(0, 3).map(function (al) { al.artistName = fa.dz.name; return al; }); }); }).then(function (lists2) {
				newRel.done();
				var all2 = [].concat.apply([], lists2.filter(Boolean)).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
				if (!all2.length) newRel.body.appendChild(h('p', { class: 'ts-muted', text: 'Nothing new from your top artists on Deezer in the last two years.' }));
				else shelf(newRel.body, all2.slice(0, 24).map(function (al) { return albumCard(al, al.artistName); }));
			});
			// more by artists you have
			pool(found.slice(0, 12), 4, function (fa) { return deezer().top(fa.dz.id, 10).then(function (ts) { return freshOnly(ts.map(function (t) { return DX.trackOf(t, { name: fa.dz.name, id: fa.dz.id }); })).slice(0, 3); }); }).then(function (lists2) {
				more.done();
				var all3 = [].concat.apply([], lists2.filter(Boolean));
				if (!all3.length) more.body.appendChild(h('p', { class: 'ts-muted', text: 'You already have their best-known songs.' }));
				else { more.head.appendChild(U.iconBtn('play', 'Preview them all', { text: true, cls: 'ts-act', on: { click: function () { pvStart(all3, 0, 'More by your artists'); } } })); dzList(more.body, all3); }
			});
		});
		// playlists of your genres
		var gc = {};
		idx().music.forEach(function (t) { if (t.genres[0]) gc[t.genres[0]] = (gc[t.genres[0]] || 0) + 1 + (liked(t) ? 3 : 0) + (t.plays || 0); });
		var topG = Object.keys(gc).filter(function (g) { return GENRE_QUERY[g]; }).sort(function (a, b) { return gc[b] - gc[a]; }).slice(0, 4);
		pool(topG, 2, function (g) {
			return deezer().searchPlaylists(GENRE_QUERY[g], 3).then(function (pls) {
				var pl = pls.filter(function (p) { return p.nb_tracks >= 10; })[0];
				if (!pl) return null;
				return deezer().playlistTracks(pl.id, 80).then(function (ts) { return { genre: g, title: pl.title, tracks: freshOnly(ts).slice(0, 10) }; });
			});
		}).then(function (rows) {
			genres.done();
			rows.filter(Boolean).forEach(function (r) {
				if (!r.tracks.length) return;
				var hd = h('div', { class: 'ts-sec-head ts-dsub' }, [h('h3', { text: r.genre }), h('span', { class: 'ts-muted', text: 'from the playlist ' + q(r.title) })]);
				hd.appendChild(U.iconBtn('play', 'Preview these', { text: true, cls: 'ts-act', on: { click: function () { pvStart(r.tracks, 0, r.genre); } } }));
				genres.body.appendChild(hd);
				dzList(genres.body, r.tracks);
			});
			if (!genres.body.querySelector('li')) genres.body.appendChild(h('p', { class: 'ts-muted', text: 'No playlists found for your genres.' }));
		});
	}
	// A preview radio from your taste: the artist mixes of three of your top artists.
	function tasteRadio(btn) {
		if (btn) btn.disabled = true;
		var seeds = topSeeds(30);
		var pick = S.trueShuffle(seeds.map(function (s2) { return s2.key; }), S.cryptoRng()).slice(0, 6);
		pool(pick, 3, function (k) { return dzArtistFor(k).then(function (d) { return d ? deezer().radio(d.id, 30) : []; }); }).then(function (lists2) {
			if (btn) btn.disabled = false;
			var all2 = freshOnly([].concat.apply([], lists2.filter(Boolean)));
			var mixed = S.spreadShuffle(all2.map(function (t) { return { id: String(t.id), spreadKey: DX.norm(t.artist), t: t }; }), S.cryptoRng(), {}).map(function (id) { return all2.filter(function (t) { return String(t.id) === id; })[0]; });
			if (!mixed.length) { say('Deezer had nothing new for your taste just now.'); return; }
			pvStart(mixed.slice(0, 60), 0, 'Your taste');
		}).catch(function (e) { if (btn) btn.disabled = false; fail(e); });
	}

	// ---- An artist on Deezer: top songs, releases, related, an artist mix ---------------------------------
	function viewDzArtist(view, id) {
		var here = location.hash;
		var head = h('div');
		view.appendChild(h('a', { class: 'ts-back', href: '#/discover', text: String.fromCharCode(0x2190) + ' Discover' }));
		view.appendChild(head);
		var top = dsection(view, 'Top songs'), rel = dsection(view, 'Releases'), like = dsection(view, 'Related artists');
		deezer().artist(id).then(function (a) {
			if (location.hash !== here || !a || !a.name) return;
			remember({ id: a.id, name: a.name });
			var known = L.normArtist(a.name), libA = idx().artists[known];
			headerBlock(head, {
				kicker: 'Artist on Deezer', title: a.name, round: true, hue: { h: 200, s: 40 }, artNode: dzImg(DX.img(a.picture_big || a.picture_medium), 'ts-hero-art', a.name, true),
				meta: (a.nb_fan ? n(a.nb_fan) + ' fans' : '') + (a.nb_album ? ' ' + DOT + ' ' + plural(a.nb_album, 'release') : '') + (libA ? ' ' + DOT + ' ' + plural(libA.tracks.length, 'song') + ' in your library' : ' ' + DOT + ' new to you'),
				actions: [
					actionBtn('radio', 'Preview artist mix', function () { deezer().radio(a.id, 50).then(function (ts) { pvStart(freshOnly(ts), 0, a.name + ' mix'); }); }, true),
					actionBtn('play', 'Preview top songs', function () { deezer().top(a.id, 20).then(function (ts) { pvStart(ts.map(function (t) { return DX.trackOf(t, a); }).filter(function (t) { return t.preview; }), 0, a.name); }); }),
					libA ? actionBtn('artist', 'In your library', function () { location.hash = link('artist', known); }) : null,
					actionBtn('close', 'Not interested', function () { hideArtist(a.name); location.hash = '#/discover'; })
				]
			});
		}).catch(function (e) { head.appendChild(h('p', { class: 'ts-empty', text: e.message })); });
		deezer().top(id, 15).then(function (ts) { top.done(); dzList(top.body, ts.map(function (t) { return DX.trackOf(t); }), 'No songs listed.'); }).catch(function () { top.done(); });
		deezer().albums(id, 60).then(function (als) { rel.done(); if (!als.length) { rel.body.appendChild(h('p', { class: 'ts-muted', text: 'No releases listed.' })); return; } return deezer().artist(id).then(function (a) { grid(rel.body, als.slice(0, 24).map(function (al) { return albumCard(al, a.name, id); }), 'is-cards'); }); }).catch(function () { rel.done(); });
		deezer().related(id).then(function (as) { like.done(); shelf(like.body, as.slice(0, 18).map(function (a) { return dzArtistCard({ id: a.id, name: a.name, picture: DX.img(a.picture_medium), fans: a.nb_fan }); })); }).catch(function () { like.done(); });
	}

	// ---- The preview radio: 30-second previews one after another -------------------------------------------
	var pv = { list: [], at: 0, audio: null, label: '' };
	function pvStart(list, at, label) {
		list = (list || []).filter(function (t) { return t && t.preview; });
		if (!list.length) { say('No previews here.'); return; }
		stopPreview();
		pv.list = list; pv.at = Math.max(0, at || 0); pv.label = label || 'Previews';
		pvPlay();
	}
	function pvPlay() {
		if (pv.audio) { pv.audio.pause(); pv.audio = null; }
		var t = pv.list[pv.at];
		if (!t) { pvClose(); say('That was the last preview.'); return; }
		if (player && player.state() === 'playing') ctl.toggle();
		pv.audio = new Audio(t.preview);
		pv.audio.volume = Math.max(0, Math.min(1, (player && !player.muted() ? player.volume() : 100) / 100));
		pv.audio.addEventListener('ended', function () { pv.at++; pvPlay(); });
		pv.audio.addEventListener('timeupdate', pvProgress);
		pv.audio.play().catch(function () { pvRender(); });
		pvRender();
	}
	function pvProgress() { var b = document.querySelector('.ts-pvbar-fill'); if (b && pv.audio && pv.audio.duration) b.style.width = (100 * pv.audio.currentTime / pv.audio.duration) + '%'; }
	function pvClose() { if (pv.audio) pv.audio.pause(); pv.audio = null; var bar = $('pvbar'); if (bar) bar.parentNode.removeChild(bar); document.body.classList.remove('has-pvbar'); }
	function pvRender() {
		var t = pv.list[pv.at], bar = $('pvbar');
		if (!t) return;
		if (!bar) { bar = h('div', { class: 'ts-pvbar', id: 'pvbar', role: 'region', aria: { label: 'Preview radio' } }); document.body.appendChild(bar); document.body.classList.add('has-pvbar'); }
		clear(bar);
		bar.appendChild(dzImg(t.cover, 'ts-pvbar-art', t.title));
		var tx = h('div', { class: 'ts-pvbar-text' }, [h('span', { class: 'ts-kicker', text: pv.label + ' ' + DOT + ' ' + (pv.at + 1) + ' of ' + pv.list.length }), h('b', { text: t.title }), t.artistId ? h('a', { href: '#/discover?dz=' + t.artistId, text: t.artist }) : h('span', { text: t.artist })]);
		bar.appendChild(tx);
		var playing = pv.audio && !pv.audio.paused;
		var tg = U.iconBtn(playing ? 'pause' : 'play', playing ? 'Pause the preview' : 'Play the preview', { on: { click: function () { if (!pv.audio) { pvPlay(); return; } if (pv.audio.paused) pv.audio.play(); else pv.audio.pause(); pvRender(); } } });
		bar.appendChild(U.iconBtn('prev', 'Previous preview', { on: { click: function () { pv.at = Math.max(0, pv.at - 1); pvPlay(); } } }));
		bar.appendChild(tg);
		bar.appendChild(U.iconBtn('next', 'Next preview', { on: { click: function () { pv.at++; pvPlay(); } } }));
		var sv = U.iconBtn('plus', 'Save for later', { text: true, cls: 'ts-save' + (isSaved(t) ? ' is-on' : ''), on: { click: function () { toggleSaved(t, sv); } } });
		bar.appendChild(sv);
		bar.appendChild(h('button', { class: 'kit-btn small', text: auth.signedIn() ? 'Play on YouTube' : 'Open YouTube', on: { click: function (e) { pvClose(); playFound(t, e.currentTarget); } } }));
		var ab5 = addButton(t);
		if (ab5) bar.appendChild(ab5);
		bar.appendChild(U.iconBtn('block', 'Not interested in ' + t.artist, { on: { click: function () { hideArtist(t.artist); var a2 = DX.norm(t.artist); pv.list = pv.list.filter(function (x, i) { return i <= pv.at || DX.norm(x.artist) !== a2; }); pv.at++; pvPlay(); } } }));
		bar.appendChild(U.iconBtn('close', 'Close the preview radio', { on: { click: pvClose } }));
		bar.appendChild(h('span', { class: 'ts-pvbar-prog' }, h('i', { class: 'ts-pvbar-fill' })));
	}

	// ---- Moods & scenes: mix and match, and the mood-by-scene grid ------------------------------------
	var MIX_ROWS = [
		['moods', 'Mood', function () { return T.MOODS.map(function (m) { return [m[0], m[1], { h: MOOD_HUE[m[0]], s: 60 }]; }); }, 'mood'],
		['scenes', 'Scene', function () { return T.SCENES.map(function (s2) { return [s2[0], s2[1], { h: SCENE_HUE[s2[0]], s: 45 }]; }); }, 'scene'],
		['langs', 'Language', function () { return T.LANGS.map(function (l) { return [l[0], l[1], null]; }); }, 'lang'],
		['families', 'Family', function () { return T.FAMILIES.map(function (f2) { return [f2.key, f2.name, familyHue(f2.key)]; }); }, null],
		['decades', 'Era', function () { return Object.keys(idx().decades).sort().map(function (d) { return [d, d, null]; }); }, 'decade'],
		['added', 'Added', function () { return Object.keys(idx().addedY).sort().reverse().map(function (y) { return [y, y, addedHue(y)]; }); }, null]
	];
	function mixFromQuery(query) {
		var p = {};
		MIX_ROWS.forEach(function (r) { var v = query.get(r[0]); if (v) p[r[0]] = v.split(',').filter(Boolean); });
		return p;
	}
	function mixName(p) {
		var parts = [];
		if (p.moods) parts.push(p.moods.map(function (m) { return T.MOOD_NAME[m]; }).join(' or '));
		if (p.families) parts.push(p.families.map(function (f2) { return (T.family(f2) || {}).name; }).join(' or '));
		if (p.scenes) parts.push(p.scenes.map(function (s2) { return T.SCENE_NAME[s2]; }).join(' or '));
		if (p.langs) parts.push(p.langs.map(function (l) { return T.LANG_NAME[l]; }).join(' or '));
		if (p.decades) parts.push(p.decades.join(' or '));
		if (p.added) parts.push('added ' + p.added.join(' or '));
		return parts.join(', ') || 'Everything';
	}
	function browseMixer(view, query) {
		var p = mixFromQuery(query), ix = idx();
		var box = h('section', { class: 'ts-mixer', aria: { label: 'Mix and match' } });
		box.appendChild(h('h2', { text: 'Mix and match' }));
		box.appendChild(h('p', { class: 'ts-muted', text: 'Pick in any rows: choices in one row are alternatives, rows narrow each other (wistful or tender, and visual novels, and Japanese).' }));
		var base = S.select(ix.music, selectOf(planWith(p, 'true')), now());
		MIX_ROWS.forEach(function (r) {
			var row = h('div', { class: 'ts-mixrow' }, [h('span', { class: 'ts-mixrow-h', text: r[1] })]);
			var cs = h('div', { class: 'ts-chips is-tight' });
			// how many songs each choice would give with the other rows as they are
			var others = {};
			for (var k in p) if (k !== r[0]) others[k] = p[k];
			var pool2 = S.select(ix.music, selectOf(planWith(others, 'true')), now());
			r[2]().forEach(function (o) {
				var cnt = S.select(pool2, selectOf(planWith((function () { var x = {}; x[r[0]] = [o[0]]; return x; })(), 'true')), now()).length;
				var on = (p[r[0]] || []).indexOf(o[0]) >= 0;
				if (!cnt && !on) return;
				var c = h('button', { class: 'ts-chip' + (on ? ' is-on' : '') + (o[2] ? ' is-hued' : ''), aria: { pressed: on ? 'true' : 'false' } }, [h('span', { text: o[1] }), h('span', { class: 'ts-count', text: n(cnt) })]);
				if (o[2]) { c.style.setProperty('--h', String(o[2].h)); c.style.setProperty('--s', o[2].s + '%'); }
				c.addEventListener('click', function () {
					var cur = (p[r[0]] || []).slice(), at = cur.indexOf(o[0]);
					if (at >= 0) cur.splice(at, 1); else cur.push(o[0]);
					var ch = {}; ch[r[0]] = cur.length ? cur.join(',') : null;
					setQuery(ch);
				});
				cs.appendChild(c);
			});
			row.appendChild(cs);
			box.appendChild(row);
		});
		var any = Object.keys(p).length > 0;
		var res = h('div', { class: 'ts-mixres' });
		res.appendChild(h('b', { text: plural(base.length, 'song') }));
		res.appendChild(h('span', { class: 'ts-muted', text: ' ' + DOT + ' ' + longTime(secs(base)) + ' ' + DOT + ' ' + mixName(p) }));
		box.appendChild(res);
		if (any) {
			var acts = h('div', { class: 'ts-actions' }, [
				actionBtn('play', 'Play', function () { playIds(sorted(base, 'artist').map(function (t) { return t.id; }), 0, { label: mixName(p), href: location.hash, patch: p }); }, true),
				shuffleSplit(p, { label: mixName(p), href: location.hash, patch: p })
			].concat(scopeButtons(p, mixName(p))).concat([actionBtn('close', 'Clear', function () { var ch = {}; MIX_ROWS.forEach(function (r) { ch[r[0]] = null; }); setQuery(ch); })]));
			box.appendChild(acts);
		}
		view.appendChild(box);
		if (any) { trackList(view, sorted(base, 'artist'), { context: { label: mixName(p), href: location.hash, patch: p }, empty: 'Nothing has all of these. Take a choice away.' }); }
		return any;
	}
	// A grid: moods down, another facet across, the count in each cell (a
	// single-hue tint for size; the number is written), every cell a link.
	var MATRIX_COLS = [['scene', 'Scene'], ['family', 'Genre family'], ['lang', 'Language'], ['added', 'Year added'], ['decade', 'Era']];
	function moodMatrix(view) {
		var ix = idx(), across = ToyKit.load('matrixCols', 'scene');
		var wrap = h('section', { class: 'ts-matrix-sec' });
		var hd = h('div', { class: 'ts-sec-head' }, [h('h2', { text: 'Moods by ' + (MATRIX_COLS.filter(function (c) { return c[0] === across; })[0] || MATRIX_COLS[0])[1].toLowerCase() })]);
		var sel = h('select', { class: 'kit-input ts-sort', aria: { label: 'Across' } });
		MATRIX_COLS.forEach(function (c) { sel.appendChild(h('option', { value: c[0], text: 'Across: ' + c[1] })); });
		sel.value = across;
		sel.addEventListener('change', function () { ToyKit.store('matrixCols', sel.value); renderView(true); });
		hd.appendChild(sel);
		wrap.appendChild(hd);
		var cols, colOf, colKey;
		if (across === 'family') { cols = T.FAMILIES.map(function (f2) { return [f2.key, f2.name]; }); colOf = function (t) { return T.trackFamily(t); }; colKey = 'families'; }
		else if (across === 'lang') { cols = T.LANGS.map(function (l) { return [l[0], l[1]]; }); colOf = function (t) { return t.lang; }; colKey = 'langs'; }
		else if (across === 'added') { cols = Object.keys(ix.addedY).sort().map(function (y) { return [y, y]; }); colOf = function (t) { return S.addedKeys(t)[0]; }; colKey = 'added'; }
		else if (across === 'decade') { cols = Object.keys(ix.decades).sort().filter(function (d) { return d >= '1960s'; }).map(function (d) { return [d, d]; }); colOf = function (t) { return t.decade; }; colKey = 'decades'; }
		else { cols = T.SCENES.map(function (s2) { return [s2[0], s2[1]]; }); colOf = function (t) { return t.scene; }; colKey = 'scenes'; }
		var cnt = {}, max = 1;
		ix.music.forEach(function (t) { if (!t.mood) return; var c = colOf(t) || ''; var k = t.mood + '|' + c; cnt[k] = (cnt[k] || 0) + 1; max = Math.max(max, cnt[k]); });
		cols = cols.filter(function (c) { return T.MOODS.some(function (m) { return cnt[m[0] + '|' + c[0]]; }); });
		var tbl = h('table', { class: 'ts-matrix' });
		var trh = h('tr', null, [h('th', { scope: 'col' })]);
		cols.forEach(function (c) { trh.appendChild(h('th', { scope: 'col', text: c[1] })); });
		tbl.appendChild(h('thead', null, trh));
		var tb = h('tbody');
		T.MOODS.forEach(function (m) {
			var tr = h('tr', null, [h('th', { scope: 'row' }, h('a', { href: link('c', 'mood', m[0]), text: m[1] }))]);
			cols.forEach(function (c) {
				var v = cnt[m[0] + '|' + c[0]] || 0, td = h('td');
				if (v) {
					var qs = 'moods=' + m[0] + '&' + colKey + '=' + encodeURIComponent(c[0]);
					var a = h('a', { href: '#/browse?' + qs, title: m[1] + ', ' + c[1] + ': ' + plural(v, 'song'), aria: { label: m[1] + ', ' + c[1] + ': ' + plural(v, 'song') }, text: String(v) });
					a.style.setProperty('--t', String(Math.round(8 + 72 * Math.sqrt(v / max))));
					td.appendChild(a);
				}
				tr.appendChild(td);
			});
			tb.appendChild(tr);
		});
		tbl.appendChild(tb);
		wrap.appendChild(h('div', { class: 'ts-matrix-wrap' }, tbl));
		wrap.appendChild(h('p', { class: 'ts-muted', text: 'Each cell opens that combination below the mixer: play it, shuffle it, focus on it or keep it as a playlist.' }));
		view.appendChild(wrap);
	}
	// On a mood page: where it lives; on a scene page: its moods.
	function facetBreakdown(view, facet, v) {
		var ix = idx(), rows = [], key = '';
		if (facet === 'mood') {
			var by = {};
			ix.music.forEach(function (t) { if (t.mood === v && t.scene) by[t.scene] = (by[t.scene] || 0) + 1; });
			rows = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (s2) { return [T.SCENE_NAME[s2] || s2, by[s2], '#/browse?moods=' + v + '&scenes=' + s2, { h: SCENE_HUE[s2], s: 45 }]; });
			var fam = {};
			ix.music.forEach(function (t) { if (t.mood === v) { var f2 = T.trackFamily(t); fam[f2] = (fam[f2] || 0) + 1; } });
			rows = rows.concat(Object.keys(fam).sort(function (a, b) { return fam[b] - fam[a]; }).slice(0, 8).map(function (f2) { return [(T.family(f2) || {}).name, fam[f2], '#/browse?moods=' + v + '&families=' + f2, familyHue(f2)]; }));
			key = 'Split it by scene or family';
		} else if (facet === 'scene') {
			var bm = {};
			ix.music.forEach(function (t) { if (t.scene === v && t.mood) bm[t.mood] = (bm[t.mood] || 0) + 1; });
			rows = T.MOODS.filter(function (m) { return bm[m[0]]; }).map(function (m) { return [m[1], bm[m[0]], '#/browse?scenes=' + v + '&moods=' + m[0], { h: MOOD_HUE[m[0]], s: 60 }]; });
			key = 'Split it by mood';
		}
		if (!rows.length) return;
		var bar = h('div', { class: 'ts-breakdown' }, [h('span', { class: 'ts-muted', text: key })]);
		var cs = h('div', { class: 'ts-chips is-tight' });
		rows.forEach(function (r) { cs.appendChild(chip(r[0] + ' ' + r[1], r[2], r[3])); });
		bar.appendChild(cs);
		var acts = view.querySelector('.ts-actions');
		if (acts) acts.parentNode.insertBefore(bar, acts.nextSibling); else view.appendChild(bar);
	}

	// ---- More of an artist: releases, other songs, their channels -------------------------------------

	function artistMore(view, key, a) {
		var here = location.hash;
		var wrap = h('section', { class: 'ts-more-artist' });
		view.appendChild(wrap);
		var others = dsection(wrap, 'Other songs by ' + a.name, 'not in your library');
		var rels = dsection(wrap, 'Albums and releases');
		var chans = dsection(wrap, 'From their YouTube channels');
		// their channels: where the library's songs by them were uploaded
		var byCh = {};
		a.tracks.forEach(function (t) { var id = t.channelId; if (!id) return; (byCh[id] = byCh[id] || { id: id, name: t.channel, n: 0 }).n++; });
		var chList = Object.keys(byCh).map(function (k) { return byCh[k]; }).sort(function (x, y) { return y.n - x.n; }).slice(0, 6);
		chans.done();
		if (!chList.length) chans.body.appendChild(h('p', { class: 'ts-muted', text: 'No channel known.' }));
		var cl = h('div', { class: 'ts-chips' });
		chList.forEach(function (c) { cl.appendChild(h('a', { class: 'ts-chip', href: link('channel', c.id) }, [h('span', { text: c.name }), h('span', { class: 'ts-count', text: plural(c.n, 'song') + ' here' })])); });
		chans.body.appendChild(cl);
		chans.body.appendChild(h('p', { class: 'ts-muted', text: 'A channel page lists its uploads on YouTube that you do not have' + (auth.signedIn() ? ' (about 2 quota units for its newest hundred).' : ' (sign in to see them here; otherwise it links to YouTube).') }));
		loadDiscoverState().then(function () { return dzArtistFor(key); }).then(function (d) {
			if (location.hash !== here) return;
			if (!d) {
				others.done(); rels.done();
				others.body.appendChild(h('p', { class: 'ts-muted', text: 'Deezer does not know ' + a.name + ' (or could not be sure it is the same artist), so their other songs and releases are not shown.' }));
				return;
			}
			others.head.appendChild(U.iconBtn('compass', 'Explore on Deezer', { text: true, cls: 'ts-act', on: { click: function () { location.hash = '#/discover?dz=' + d.id; } } }));
			deezer().top(d.id, 40).then(function (ts) {
				others.done();
				var fresh = freshOnly(ts.map(function (t) { return DX.trackOf(t, { name: d.name, id: d.id }); }));
				if (!fresh.length) { others.body.appendChild(h('p', { class: 'ts-muted', text: 'You already have their best-known songs.' })); return; }
				others.head.appendChild(U.iconBtn('play', 'Preview them', { text: true, cls: 'ts-act', on: { click: function () { pvStart(fresh, 0, a.name); } } }));
				dzList(others.body, fresh.slice(0, 25));
			}).catch(function (e) { others.done(); others.body.appendChild(h('p', { class: 'ts-muted', text: e.message })); });
			deezer().albums(d.id, 60).then(function (als) {
				rels.done();
				if (!als.length) { rels.body.appendChild(h('p', { class: 'ts-muted', text: 'No releases listed.' })); return; }
				var kinds = { album: 'Albums', ep: 'EPs', single: 'Singles', compile: 'Compilations' }, groups = {};
				als.forEach(function (al) { var k = kinds[al.type] ? al.type : 'album'; (groups[k] = groups[k] || []).push(al); });
				['album', 'ep', 'single', 'compile'].forEach(function (k) {
					if (!groups[k]) return;
					rels.body.appendChild(h('h3', { class: 'ts-subh', text: kinds[k] + ' (' + groups[k].length + ')' }));
					shelf(rels.body, groups[k].slice(0, 30).map(function (al) { return albumCard(al, d.name, d.id); }));
				});
			}).catch(function (e) { rels.done(); rels.body.appendChild(h('p', { class: 'ts-muted', text: e.message })); });
		});
	}

	// ---- A YouTube channel: the songs here from it, and its other uploads --------------------------------
	var channelCache = {};
	function viewChannel(view, parts) {
		var id = parts[0], ix = idx();
		var mine = ix.all.filter(function (t) { return t.channelId === id; });
		var name = mine.length ? mine[0].channel : 'Channel';
		headerBlock(view, {
			kicker: 'YouTube channel', title: name, hue: { h: 0, s: 45 }, artNode: mine[0] ? artFor(mine[0], 'ts-hero-art') : null,
			meta: plural(mine.length, 'song') + ' in your library',
			actions: [
				mine.length ? actionBtn('play', 'Play', function () { playIds(sorted(mine, 'added').map(function (t) { return t.id; }), 0, { label: name, href: link('channel', id), patch: { channels: [id] } }); }, true) : null,
				mine.length > 1 ? shuffleSplit({ channels: [id] }, { label: name, href: link('channel', id), patch: { channels: [id] } }) : null,
				U.iconBtn('external', 'Open on YouTube', { text: true, cls: 'ts-act', on: { click: function () { window.open('https://www.youtube.com/channel/' + encodeURIComponent(id), '_blank', 'noopener'); } } })
			]
		});
		if (mine.length) { sectionHead(view, 'In your library'); trackList(view, sorted(mine, 'added'), { context: { label: name, href: link('channel', id) } }); }
		var up = dsection(view, 'More uploads on this channel', 'newest first, the ones you do not have');
		if (demo || !/^UC[A-Za-z0-9_-]{22}$/.test(id)) { up.done(); up.body.appendChild(h('p', { class: 'ts-muted', text: demo ? 'The demo has no YouTube channels.' : 'This channel cannot be listed.' })); return; }
		if (!auth.signedIn()) {
			up.done();
			up.body.appendChild(h('p', { class: 'ts-muted', text: 'Sign in (Settings) to list this channel\u2019s uploads here and play them, or open it on YouTube.' }));
			return;
		}
		var here = location.hash;
		function show(items) {
			up.done();
			var fresh = items.filter(function (it) { return !lib.tracks[it.videoId] && !it.unavailable; });
			if (!fresh.length) { up.body.appendChild(h('p', { class: 'ts-muted', text: 'You have every recent upload.' })); return; }
			var ul = h('ul', { class: 'ts-dlist' });
			fresh.forEach(function (it) {
				var li = h('li', { class: 'ts-drow' });
				li.appendChild(prefs.art ? U.art(it.videoId, 0, it.title, 'ts-q-art', true, 0) : U.swatch(0, it.title, 'ts-q-art', 0));
				li.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: it.title }), h('span', { class: 'ts-q-artist', text: (it.addedAt ? String(it.addedAt).slice(0, 10) + ' ' + DOT + ' ' : '') + name })]));
				li.appendChild(h('button', { class: 'kit-btn small', text: 'Play', title: 'Play it here; it joins the playlist Discovered', on: { click: function (e) { playFound({ id: it.videoId, artist: name, title: it.title, _video: { videoId: it.videoId, title: it.title, channel: name } }, e.currentTarget); } } }));
				var ab4 = addButton({ id: it.videoId, artist: name, title: it.title, _video: { videoId: it.videoId, title: it.title, channel: name } });
				if (ab4) li.appendChild(ab4);
				li.appendChild(U.iconBtn('external', 'Open on YouTube', { on: { click: function () { window.open('https://www.youtube.com/watch?v=' + it.videoId, '_blank', 'noopener'); } } }));
				ul.appendChild(li);
			});
			up.body.appendChild(ul);
		}
		if (channelCache[id]) { show(channelCache[id]); return; }
		var uploads = 'UU' + id.slice(2), items = [];
		client.playlistPage(uploads, '').then(function (p1) {
			items = p1.items;
			return p1.nextPageToken ? client.playlistPage(uploads, p1.nextPageToken).then(function (p2) { items = items.concat(p2.items); }) : null;
		}).then(function () { channelCache[id] = items; if (location.hash === here) show(items); }).catch(function (e) { up.done(); up.body.appendChild(h('p', { class: 'ts-muted', text: e.message || String(e) })); });
	}

	// ---- Add a song to one of the account's YouTube playlists ----------------------------------------
	// The page reads YouTube with a read-only sign-in. Adding asks Google, once, for permission to
	// edit playlists (Y.WRITE_SCOPE); the add then costs 50 quota units (151 with the search that
	// finds the video for a song from Deezer). The song joins the library under that playlist.

	var PENDING_ADD = 'toy.101-true-shuffle.pendingAdd';
	// The account's own playlists in the library: not Liked videos, not the local Discovered.
	function ytTargets() {
		return Object.keys(lib.playlists).map(function (k) { return lib.playlists[k]; })
			.filter(function (p) { return p && !p.special && !/^local:/.test(p.id) && !/^LL/.test(p.id); })
			.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
	}
	function ytTarget() { var ts = ytTargets(), last = ToyKit.load('addTo', ''); return ts.filter(function (p) { return p.id === last; })[0] || ts[0] || null; }
	function addLabel() { var tg = ytTarget(); return tg ? 'Add to ' + (tg.title || 'playlist') : 'Add to playlist'; }
	// The video id a found song already has, if any.
	function videoOf(t) { return t._video ? t._video.videoId : (lib.tracks[t.id] ? t.id : null); }
	function inPlaylist(vid, p) { var tr = vid && lib.tracks[vid]; return !!(tr && tr.playlists.indexOf(p.id) >= 0); }

	// The Add button for a song that is not in the playlist yet.
	function addButton(t, cls) {
		var tg = ytTarget(), vid = videoOf(t);
		if (demo || !tg || (vid && ytTargets().every(function (p) { return inPlaylist(vid, p); }))) return null;
		var b = h('button', { class: 'kit-btn small ts-addyt' + (cls ? ' ' + cls : ''), text: 'Add', title: addLabel() + ' on YouTube (' + (vid ? 50 : 151) + ' quota units)', aria: { label: addLabel() + ' on YouTube: ' + t.title } });
		b.addEventListener('click', function (e) { e.stopPropagation(); addToYouTube(t, b); });
		return b;
	}
	// Pick the playlist (a menu when there are several), then add.
	function addToYouTube(t, btn) {
		if (demo) { say('The demo cannot change YouTube playlists.'); return; }
		var ts = ytTargets(), vid = videoOf(t);
		if (!ts.length) { say('Import one of your YouTube playlists first (Settings); songs can then be added to it.'); return; }
		var open = ts.filter(function (p) { return !inPlaylist(vid, p); });
		if (!open.length) { say(q(t.title) + ' is already in your playlists.'); return; }
		if (ts.length === 1) { addTo(t, open[0], btn); return; }
		var last = ToyKit.load('addTo', '');
		U.openMenu(btn, [{ heading: 'Add to a YouTube playlist' }].concat(ts.map(function (p) {
			var has = inPlaylist(vid, p);
			return { label: p.title || p.id, icon: 'list', hint: has ? 'in it' : n(p.count || 0), checked: p.id === last, disabled: has, onSelect: function () { if (!has) addTo(t, p, btn); } };
		})), { label: 'Add to a YouTube playlist', returnTo: btn && btn.nodeType ? btn : null });
	}
	// Ask for permission to edit playlists. The redirect leaves the page, so the add is kept and
	// finished when Google sends the reader back (afterSignInReturn).
	function askWrite(t, p) {
		var d = U.openDialog({ title: 'Allow adding to your playlists?' });
		d.body.appendChild(h('p', { text: 'True Shuffle only reads your YouTube account so far. To add ' + q(t.title) + ' to ' + q(p.title) + ', Google will ask once whether this page may also manage your YouTube account: Google has no narrower permission for adding to a playlist. The page only ever adds songs you choose, to the playlist you choose.' }));
		d.body.appendChild(h('p', { class: 'ts-muted', text: 'The permission lasts for this sign-in (about an hour, in this tab). Disconnect in Settings takes it back.' }));
		var go = h('button', { class: 'kit-btn primary', text: 'Continue to Google', on: { click: function () {
			d.close();
			if (!auth.configured()) { location.hash = '#/settings'; say('Signing in needs a Google client id: see Settings.'); return; }
			try { sessionStorage.setItem(PENDING_ADD, JSON.stringify({ t: slimFound(t), playlistId: p.id, hash: location.hash, at: Date.now() })); } catch (e) { /* no storage: the add is asked for again after the sign-in */ }
			setStatus('Going to Google' + ELL);
			auth.signIn({ scope: Y.SCOPE + ' ' + Y.WRITE_SCOPE }).then(function () { finishPendingAdd(false); }).catch(fail);
		} } });
		d.body.appendChild(h('div', { class: 'ts-row-btns' }, [go, h('button', { class: 'kit-btn', text: 'Not now', on: { click: d.close } })]));
		go.focus();
	}
	function slimFound(t) {
		var o = { id: t.id, artist: t.artist || '', title: t.title || '' };
		if (t._video) o._video = { videoId: t._video.videoId, title: t._video.title || '', channel: t._video.channel || '' };
		return o;
	}
	// Back from Google: finish the add that sent the reader there. -> true when there was one.
	function finishPendingAdd(denied) {
		var pend = null;
		try { pend = JSON.parse(sessionStorage.getItem(PENDING_ADD) || 'null'); sessionStorage.removeItem(PENDING_ADD); } catch (e) { pend = null; }
		if (!pend || !pend.t || Date.now() - pend.at > 600000) return false;
		if (pend.hash) location.hash = pend.hash;
		var p = lib.playlists[pend.playlistId];
		if (denied || !auth.canWrite()) { say('Google did not allow editing your playlists, so ' + q(pend.t.title) + ' was not added.'); return true; }
		if (!p) { say('That playlist is no longer in the library.'); return true; }
		addTo(pend.t, p, null);
		return true;
	}
	function addTo(t, p, btn) {
		if (btn && !btn.nodeType) btn = null;
		if (!auth.signedIn() || !auth.canWrite()) { askWrite(t, p); return; }
		if (btn) btn.disabled = true;
		var found = !t._video && !lib.tracks[t.id], vid = videoOf(t), wasIn = !!(vid && lib.tracks[vid]);
		setStatus('Adding ' + q(t.title) + ' to ' + q(p.title) + ELL);
		var find = vid ? Promise.resolve(vid) : client.search(DX.youtubeQuery(t), { max: 6 }).then(function (results) {
			var best = DX.bestVideo(results, t);
			if (!best) throw new Error('YouTube found nothing for ' + q(DX.youtubeQuery(t)) + '.');
			vid = best.videoId; wasIn = !!lib.tracks[vid];
			return vid;
		});
		var item = null;
		find.then(function () {
			if (inPlaylist(vid, p)) throw new Error(q(t.title) + ' is already in ' + q(p.title) + '.');
			return client.addToPlaylist(p.id, vid);
		}).then(function (r) {
			item = r;
			var when = r.addedAt || new Date().toISOString();
			if (lib.tracks[vid]) return lib.tracks[vid];
			return client.videoBatch([vid]).then(function (res) {
				if (!res.videos.length) return null;
				var at = {}; at[vid] = when;
				L.upsert(lib, res.videos, { playlistId: p.id, addedAt: at, now: Date.now() });
				return lib.tracks[vid];
			});
		}).then(function (tr) {
			var when = item.addedAt || new Date().toISOString();
			if (tr) {
				if (tr.playlists.indexOf(p.id) < 0) tr.playlists.push(p.id);
				if (!tr.addedAt[p.id]) tr.addedAt[p.id] = when;
				if (found && !tr.labels) tr.labels = { artist: t.artist, title: t.title };
				L.deriveIds(lib, [tr.id]);
			}
			p.count = (p.count || 0) + 1;
			ToyKit.store('addTo', p.id);
			return store.putPlaylists([p]).then(function () { return tr ? changed([tr.id], true) : saveMeta(); }).then(function () {
				if (btn) { btn.textContent = 'Added'; btn.classList.add('is-done'); }
				setStatus('');
				U.toast('Added ' + q(t.title) + ' to ' + q(p.title) + ' on YouTube.', { action: 'Undo', onAction: function () { undoAdd(item, p, vid, wasIn, btn); } });
			});
		}).catch(function (err) {
			if (btn) btn.disabled = false;
			setStatus('');
			if (err && err.code === 'needs-write') { askWrite(t, p); return; }
			onApiError(err);
		});
	}
	function undoAdd(item, p, vid, wasIn, btn) {
		client.removeFromPlaylist(item.itemId).then(function () {
			var tr = lib.tracks[vid];
			p.count = Math.max(0, (p.count || 1) - 1);
			var done;
			if (tr) {
				tr.playlists = tr.playlists.filter(function (x) { return x !== p.id; });
				delete tr.addedAt[p.id];
			}
			if (tr && !wasIn && !tr.playlists.length) { delete lib.tracks[vid]; done = store.deleteTracks([vid]).then(function () { dirty(); return saveMeta(); }); }
			else done = tr ? changed([vid], true) : saveMeta();
			return Promise.all([done, store.putPlaylists([p])]).then(function () {
				if (btn) { btn.textContent = 'Add'; btn.disabled = false; btn.classList.remove('is-done'); }
				renderAll();
				say('Taken out of ' + q(p.title) + ' again.');
			});
		}).catch(onApiError);
	}

	// ---- Keys ----------------------------------------------------------------------------------------------

	function wireKeys() {
		document.addEventListener('keydown', function (e) {
			if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
			if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
			if (route.parts[0] === 'label' && labelKeys && !U.dialogOpen() && labelKeys(e)) { e.preventDefault(); return; }
			var tag = (e.target && e.target.tagName) || '';
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) { if (e.key === 'Escape' && e.target.id === 'search') e.target.blur(); return; }
			if (U.dialogOpen() || document.querySelector('.kit-backdrop:not([hidden])')) return;
			var k = e.key;
			if (k === 'Escape' && document.body.classList.contains('sheet-open')) { closeSheet(); return; }
			if (k === ' ' || k === 'Spacebar') { if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return; e.preventDefault(); togglePlay(); }
			else if (k === 'n' || k === 'N') goNext();
			else if (k === 'p' || k === 'P') goPrev();
			else if (k === 's' || k === 'S') reshuffle();
			else if (k === 'q' || k === 'Q') toggleSheet();
			else if (k === 'o' || k === 'O') modeMenu($('btn-mode'));
			else if (k === 'r' || k === 'R') toggleRepeat();
			else if (k === 'l' || k === 'L') toggleLike(ctl && lib.tracks[ctl.current()]);
			else if (k === 'm' || k === 'M') toggleMute();
			else if (k === 't' || k === 'T') setTheater(!document.body.classList.contains('is-theater'));
			else if (k === 'f' || k === 'F') toggleFullscreen();
			else if (k === '?') showShortcuts();
			else if (k === '-' || k === '_') setVolume((player.muted() ? 0 : player.volume()) - 10);
			else if (k === '=' || k === '+') setVolume((player.muted() ? 0 : player.volume()) + 10);
			else if ((k === 'e' || k === 'E') && ctl && ctl.current()) openEditor([ctl.current()]);
			else if (k === '/') { e.preventDefault(); $('search').focus(); $('search').select(); }
			else if ((k === 'ArrowRight' || k === 'ArrowLeft') && tag !== 'BUTTON' && !(e.target.closest && e.target.closest('.ts-row')) && player.state() !== 'idle') {
				e.preventDefault();
				var tm = player.time();
				player.seek(Math.max(0, Math.min(tm.duration || 0, tm.current + (k === 'ArrowRight' ? 10 : -10))));
			}
		});
	}
	function wireShell() {
		var bk = $('nav-back'), fw = $('nav-fwd');
		bk.appendChild(icon('back'));
		fw.appendChild(icon('fwd'));
		bk.addEventListener('click', function () { history.back(); });
		fw.addEventListener('click', function () { history.forward(); });
		$('search-form').querySelector('.ts-search-icon').appendChild(icon('search'));
		var search = $('search');
		var go = later(function () {
			var v = search.value;
			var hash = '#/search' + (v ? '?q=' + encodeURIComponent(v) : '');
			if (route.parts[0] === 'search') { history.replaceState(null, '', hash); route = U.parseHash(hash); renderView(true); renderNav(); }
			else location.hash = hash;
		}, 180);
		search.addEventListener('input', go);
		search.addEventListener('focus', function () { if (route.parts[0] !== 'search' && search.value) go(); });
		$('search-form').addEventListener('submit', function (e) { e.preventDefault(); go(); });
		[['btn-prev', 'prev'], ['btn-next', 'next'], ['btn-reshuffle', 'shuffle'], ['btn-edit-now', 'edit'], ['btn-queue', 'queue'], ['btn-mode', 'shuffle'], ['btn-toggle', 'play'], ['sheet-close', 'down']].forEach(function (b) { U.setIcon($(b[0]), b[1]); });
		$('btn-toggle').addEventListener('click', togglePlay);
		$('btn-next').addEventListener('click', goNext);
		$('btn-prev').addEventListener('click', goPrev);
		$('btn-reshuffle').addEventListener('click', reshuffle);
		$('btn-mode').addEventListener('click', function (e) { modeMenu(e.currentTarget); });
		$('btn-queue').addEventListener('click', toggleSheet);
		$('sheet-close').addEventListener('click', closeSheet);
		$('btn-edit-now').addEventListener('click', function () { if (ctl && ctl.current()) openEditor([ctl.current()]); });
		$('poster').addEventListener('click', togglePlay);
		$('stale-signin').addEventListener('click', signIn);
		$('focus-btn').addEventListener('click', function (e) { focusMenu(e.currentTarget); });
		U.setIcon($('btn-repeat'), 'repeat');
		U.setIcon($('btn-sleep'), 'moon');
		$('btn-repeat').addEventListener('click', toggleRepeat);
		$('btn-sleep').addEventListener('click', function (e) { sleepMenu(e.currentTarget); });
		dropTarget($('now'), function (ids) { queueLater(ids); });
		ToyKit.onTheme(function () { if (mapRedraw) mapRedraw(); });
		wireResizer();
		U.setIcon($('btn-theater'), 'theater');
		$('btn-theater').addEventListener('click', function () { setTheater(!document.body.classList.contains('is-theater')); });
		$('btn-like').addEventListener('click', function () { toggleLike(ctl && lib.tracks[ctl.current()]); });
		$('btn-mute').addEventListener('click', toggleMute);
		$('vol').addEventListener('input', function () { setVolume(+$('vol').value); });
		$('vol').addEventListener('wheel', function (e) { e.preventDefault(); setVolume((player.muted() ? 0 : player.volume()) + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
		document.addEventListener('fullscreenchange', function () { document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement); });
		wireSeekTip();
		wireFileDrop();
		applyDensity();
		renderVolume();
		renderVbar();
		var seek = $('seek');
		seek.addEventListener('input', function () { seeking = true; $('time-cur').textContent = clock(+seek.value); });
		seek.addEventListener('change', function () { seeking = false; player.seek(+seek.value); });
		player.on('state', function (e) { renderTransport(); renderTime(); if (e && (e.state === 'playing' || e.state === 'paused')) playerMessage(null); if (e && e.state === 'playing' && pv.audio && !pv.audio.paused) { pv.audio.pause(); pvRender(); } if (e && e.state === 'playing') { if (previewAudio) stopPreview(); if (pauseOnStart) { pauseOnStart = false; ctl.pause(); say('Sleep timer: paused after the track.'); } } });
		player.on('time', renderTime);
		window.addEventListener('hashchange', onRoute);
	}

	// ---- Start ---------------------------------------------------------------------------------------------

	var VIEWS = {
		'': viewHome, search: viewSearch, songs: viewSongs, artists: viewArtists, artist: viewArtist, genres: viewGenres, genre: viewGenre,
		family: viewFamily, c: viewFacet, browse: viewBrowse, works: viewWorks, work: viewWork, track: viewTrack, mix: viewMix,
		stats: viewStats, fix: viewFix, settings: viewSettings, library: viewLibrary,
		lists: viewLists, list: viewList, liked: viewLiked, channel: viewChannel, history: viewHistory, label: viewLabel, map: viewMap, discover: viewDiscover
	};
	function renderAll() {
		renderNav();
		renderView(true);
		renderBar();
		renderNowInfo();
		renderQueue();
		renderTime();
		renderStale();
	}
	function loadSettings() {
		if (thumb) return Promise.resolve();
		return Promise.all([store.get('plan', null), store.get('presets', []), store.get('quota', null), store.get('context', null), store.get('lists', null), store.get('focus', null)]).then(function (r) {
			lists = Array.isArray(r[4]) ? r[4] : (Array.isArray(r[1]) ? r[1].map(function (p) { return { id: newId(), name: p.name, kind: 'smart', patch: patchOf(copyPlan(p.plan)), mode: p.plan && p.plan.mode, created: new Date().toISOString() }; }) : []);
			focus = r[5] && lists.some(function (li) { return li.id === r[5]; }) ? r[5] : null;
			plan = copyPlan(r[0] || DEFAULT_PLAN);
			if (!ORDER.some(function (o) { return o.key === plan.mode; })) plan.mode = 'true';
			stations = Array.isArray(r[1]) ? r[1] : [];
			quota = r[2];
			if (r[3] && r[3].label) context = r[3];
		});
	}
	// The stored queue if there is one, else a new one from the plan. Nothing plays.
	function startQueue() {
		if (thumb) return thumbQueue();
		return store.get('queue', null).then(function (saved) {
			var ok = saved && Array.isArray(saved.items) && saved.items.length;
			if (ok) {
				var items = saved.items.filter(function (id) { return lib.tracks[id]; });
				var at = items.indexOf(saved.items[saved.index | 0]);
				if (at < 0) at = Math.min(Math.max(-1, saved.index | 0), items.length);
				makeController({ items: items, index: items.length ? Math.max(0, Math.min(at, items.length - 1)) : -1, history: (saved.history || []).filter(function (id) { return lib.tracks[id]; }), done: false, repeat: !!saved.repeat });
				queueMode = context.list ? 'list' : plan.mode === 'true' ? 'true' : 'plan';
				return queueMode === 'true' ? ensureBag() : null;
			}
			makeController(S.queueInit());
			return L.list(lib).length ? applyPlan({}) : null;
		});
	}
	function thumbQueue() {
		context = { label: 'Everything', href: '#/songs', patch: {} };
		return ensureBag().then(function () {
			var drawn = S.bagTake(bag, 31, bagRand);
			bag = drawn.bag;
			queueMode = 'true';
			makeController({ items: drawn.ids, index: 23, history: drawn.ids.slice(0, 23), done: false, repeat: false });
			showDock();
			ctl.resume();
			return Promise.resolve().then(function () {
				var real = player.real();
				if (real && real.tick) real.tick(97000);
			});
		});
	}

	function start() {
		ToyKit.init({ id: ID, title: 'True Shuffle', sub: 'Your YouTube playlists, in the order you ask for.', back: 'misc', help: '#help-template' });
		if (demo) {
			$('demo-banner').hidden = false;
			$('demo-tag').hidden = false;
			document.documentElement.classList.add('is-demo');
		}
		player = lazyPlayer();
		wireShell();
		wireQueue();
		wireKeys();
		auth.onChange(function () { if (store && route.parts[0] === 'settings') renderView(true); });
		var opened = demo ? Promise.resolve(TS.store.memory()) : TS.store.open();
		opened.then(function (s) {
			store = s;
			if (demo) {
				demoInfo = TS.demo.build(now());
				lib = demoInfo.lib;
				mockErrors = demoInfo.errors || {};
				$('demo-text').textContent = demoInfo.label;
				return;
			}
			if (s.fallback) say('This browser will not let the page keep data (' + (s.reason || 'storage refused') + '), so nothing will be remembered after this tab closes.');
			return s.loadLibrary().then(function (parts) { lib = L.fromParts(parts); });
		}).then(loadSettings).then(function () { return Promise.all([loadHistory(), loadLM()]); }).then(startQueue).then(function () {
			dirty();
			renderAll();
			renderView(false);
			ToyKit.ready();
			afterSignInReturn();
			checkInbox().then(applySiteLabels);
			window.addEventListener('focus', function () { checkInbox(); });
			queueSync();
		}).catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
	}
	function afterSignInReturn() {
		if (demo) return;
		if (back.status === 'error') { try { sessionStorage.removeItem(PENDING_ADD); } catch (e) { /* none */ } say(back.error.message); return; }
		if (back.status !== 'signed-in') return;
		if (finishPendingAdd(!!back.writeDenied)) return;
		location.hash = '#/settings';
		listSources().then(function () {
			var stale = L.stale(lib, Date.now(), TS.config.refreshDays);
			if (stale.length) { setStatus('Refreshing ' + plural(stale.length, 'track') + ' whose YouTube details are older than ' + TS.config.refreshDays + ' days' + ELL); return refreshAll(false); }
		});
	}

	// Test hook: read-only views for scripts/qa/drive.mjs. Never used by the page.
	var hook = {};
	['lib', 'store', 'ctl', 'player', 'auth', 'plan', 'bag', 'client', 'stations', 'session', 'context'].forEach(function (k) {
		Object.defineProperty(hook, k, { get: function () { return { lib: lib, store: store, ctl: ctl, player: player, auth: auth, plan: plan, bag: bag, client: client, stations: stations, session: session, context: context }[k]; } });
	});
	hook.presets = hook.stations;
	hook.mockErrors = function (map) { if (map && (local || demo)) mockErrors = map; return mockErrors; };
	hook.applyPlan = applyPlan;
	hook.setPlan = function (p) { plan = copyPlan(p); return applyPlan({}); };
	hook.shuffleThese = shuffleThese;
	hook.lists = function () { return lists; };
	hook.setFocus = function (id) { setFocus(id); };
	hook.createSmart = function (name, patch) { var li = { id: newId(), name: name, kind: 'smart', patch: patch }; lists.push(li); saveLists(); return li.id; };
	hook.playIds = playIds;
	hook.scopeTracks = scopeTracks;
	hook.applySiteLabels = applySiteLabels;
	window.__ts = hook;

	start();
})();
