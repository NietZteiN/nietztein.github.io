/*
 * True Shuffle: the page. DOM, input and wiring of the core modules
 * (config, parse, library, shuffle, store, player, demo, yt; README.md
 * describes them). Imported titles are untrusted text: everything from
 * YouTube or from a file goes on the page through textContent.
 */
(function () {
	'use strict';

	var TS = window.TrueShuffle, L = TS.library, S = TS.shuffle, Y = TS.yt, P = TS.player, Parse = TS.parse;
	var ID = '101-true-shuffle';
	var STAR = String.fromCharCode(0x2605), DOT = String.fromCharCode(0xB7), TIMES = String.fromCharCode(0xD7);
	var ELL = String.fromCharCode(0x2026), LQ = String.fromCharCode(0x201C), RQ = String.fromCharCode(0x201D), NDASH = String.fromCharCode(0x2013);
	var FIXED_NOW = Date.UTC(2026, 9, 5, 19, 30, 0);
	var HOUR = 3600000;

	var thumb = ToyKit.thumb;
	var demo = thumb || ToyKit.params.get('demo') === '1';
	var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
	// Tests only: ?player=mock on localhost plays the imported library on the
	// mock. Read from the address when the player is built, because the
	// sign-in puts the query back only after the kit has read it.
	function mockOnLocal() { return !demo && local && new URLSearchParams(location.search).get('player') === 'mock'; }
	var speed = Math.max(1, Math.min(2000, +ToyKit.params.get('speed') || 1));

	function now() { return thumb ? FIXED_NOW : Date.now(); }
	function $(id) { return document.getElementById(id); }

	// ---- Small helpers ---------------------------------------------------------------------

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function btn(cls, text, label) {
		var b = el('button', cls, text);
		b.type = 'button';
		if (label) b.setAttribute('aria-label', label);
		return b;
	}
	function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
	function n(x) { return (+x || 0).toLocaleString('en-US'); }
	function plural(k, one, many) { return n(k) + ' ' + (k === 1 ? one : (many || one + 's')); }
	function clock(sec) { sec = Math.max(0, Math.round(+sec || 0)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }
	function longTime(sec) { var m = Math.round((+sec || 0) / 60); if (m < 60) return m + ' min'; var h = Math.floor(m / 60); return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); }
	function q(s) { return LQ + s + RQ; }
	function trackTitle(t) { return (t && (t.title || (t.raw && t.raw.title))) || 'Untitled'; }
	// A track with no artist anything vouches for shows its channel in the
	// artist's place, marked as a guess.
	function trackArtist(t) { return t && t.artist ? t.artist : t && t.artistGuess ? t.artistGuess + ' (guess)' : 'Unknown artist'; }
	function setStatus(text) { $('status').textContent = text || ''; }
	function fail(err) {
		var msg = err && err.message ? err.message : String(err);
		setStatus(msg);
		if (err && err.code !== 'aborted') ToyKit.toast(msg);
	}
	function later(fn, ms) { var t = 0; return function () { clearTimeout(t); t = setTimeout(fn, ms || 0); }; }

	// ---- State ------------------------------------------------------------------------------

	var store = null, lib = L.create(), demoInfo = null, player = null, ctl = null;
	var mockErrors = {};
	var DEFAULT_PLAN = { mode: 'true', playlists: [], genres: [], decades: [], artists: [], lengths: [], maxTracks: null, maxMinutes: null, hours: null, keepRuns: true, blockSize: 3 };
	var plan = copyPlan(DEFAULT_PLAN);
	var presets = [];
	var bag = null, bagKey = '', bagRand = thumb ? S.rng('thumb') : S.cryptoRng();
	var session = { count: 0, seconds: 0 };
	var quota = null;
	var selected = {};
	var libLimit = 150, openFix = null;
	var sources = null, importing = null, mbJob = null;
	var queueMode = '';             // the mode that filled the queue ('true': its tracks came from the bag)

	function copyPlan(p) {
		var o = {};
		for (var k in DEFAULT_PLAN) o[k] = Array.isArray(DEFAULT_PLAN[k]) ? ((p && Array.isArray(p[k])) ? p[k].slice() : []) : (p && k in p ? p[k] : DEFAULT_PLAN[k]);
		return o;
	}
	function selectOf(p) {
		var s = {};
		['playlists', 'genres', 'decades', 'artists', 'lengths'].forEach(function (k) { if (p[k] && p[k].length) s[k] = p[k].slice(); });
		if (p.hours > 0) s.notPlayedWithinHours = +p.hours;
		return s;
	}
	function limitsOf(p) { return { maxTracks: p.maxTracks > 0 ? +p.maxTracks : 0, maxMinutes: p.maxMinutes > 0 ? +p.maxMinutes : 0 }; }
	function modeInfo(key) {
		if (key === 'original') return { key: 'original', name: 'Original order', blurb: 'Your playlists in their own order: oldest addition first, one playlist after another.' };
		for (var i = 0; i < S.MODES.length; i++) if (S.MODES[i].key === key) return S.MODES[i];
		return S.MODES[0];
	}
	function chosenTracks() { return S.select(L.list(lib), selectOf(plan), now()); }

	// ---- Auth and API (never used in the demo) ----------------------------------------------

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
			renderQuota();
		}
	});

	// ---- The player and the queue -----------------------------------------------------------

	// A player that builds the real one (YouTube, or the mock) on the first
	// load(), so nothing is fetched from YouTube before the reader presses Play.
	function lazyPlayer() {
		var real = null, subs = [];
		function make() {
			if (real) return real;
			var box = $('player'), poster = $('poster');
			if (poster && poster.parentNode) poster.parentNode.removeChild(poster);
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
			destroy: function () { if (real) real.destroy(); }
		};
	}

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
				store.addHistory({ id: id, at: info.at, kind: info.completed || (t.durationSec && info.listenedSec >= t.durationSec / 2) ? 'play' : 'skip', listenedSec: info.listenedSec });
				libDirty();
			},
			onUnplayable: function (id, code) {
				var t = L.markUnplayable(lib, id, code, now());
				if (t) store.putTracks([t]);
				refusals.push(code);
				if (refusals.length > 5) refusals.shift();
				// it is no longer playable, so it leaves the bag and the count
				if (plan.mode === 'true' && bag) ensureBag().then(renderListen).catch(fail);
				var msg = 'Skipped ' + q(trackTitle(t)) + ': ' + (P.ERROR_TEXT[code] || 'it cannot be played.') + ' It is listed under ' + q('Gone or cannot be embedded') + '.';
				setStatus(msg);
				ToyKit.toast('Skipped: ' + trackTitle(t));
				libDirty();
			},
			onError: function (id, code, message) { refusals.push(0); if (refusals.length > 5) refusals.shift(); setStatus(message || 'This track could not be played.'); },
			onNeedMore: function () { return plan.mode === 'true' && bag ? bagDraw(5) : []; },
			onHalt: function (reason) {
				if (reason === 'finished') setStatus('The queue has finished. Press ' + q('Shuffle again') + ' for more.');
				else if (reason === 'errors') setStatus(haltReason());
				else setStatus('The YouTube player could not be started here.');
				renderTransport();
			}
		});
		return ctl;
	}

	// Why five tracks in a row failed: the codes YouTube gave, when it gave any.
	var refusals = [];
	function haltReason() {
		var last = refusals.slice(-5), head = 'Five tracks in a row could not be played, so playback stopped. ';
		var embed = last.filter(function (c) { return c === 101 || c === 150; }).length, gone = last.filter(function (c) { return c === 100; }).length;
		var where = '; they are listed under ' + q('Gone or cannot be embedded') + '.';
		refusals = [];
		if (last.length >= 5 && embed === last.length) return head + 'Their owners do not allow them to be played on other sites' + where;
		if (last.length >= 5 && gone === last.length) return head + 'They were removed or made private' + where;
		if (last.length >= 5 && embed + gone === last.length) return head + 'YouTube refused each of them (removed, private, or not allowed on other sites)' + where;
		return head + 'Is the network down?';
	}

	// A new queue. With play, the first track starts now; otherwise it waits for Play.
	function setQueue(ids, play) {
		var old = ctl ? ctl.state() : S.queueInit();
		if (play) { ctl.load(ids, 0); return; }
		makeController({ items: ids.slice(), index: ids.length ? 0 : -1, history: old.history.slice(), done: false, repeat: old.repeat });
		if (!thumb) store.set('queue', ctl.state());
		afterQueueChange('load');
	}
	// Keep the track that is on, replace what comes after it.
	function replaceUpcoming(ids, play) {
		var cur = ctl.current(), started = player.id() != null, fromBag = queueMode === 'true';
		queueMode = plan.mode;
		if (cur != null && started) {
			if (fromBag) returnToBag(S.upcoming(ctl.state()));
			ids = ids.filter(function (id) { return id !== cur; });
			ctl.clearUpcoming();
			if (ids.length) ctl.enqueue(ids); else afterQueueChange('plan');
			if (play && player.state() !== 'playing') ctl.resume();
		} else {
			if (fromBag) returnToBag(S.upcoming(ctl.state()).concat(cur != null ? [cur] : []));
			setQueue(ids, play);
		}
	}

	// ---- The bag (the endless true shuffle) ---------------------------------------------------

	function ensureBag() {
		var sel = selectOf(plan), key = 'bag:' + S.signature(sel), chosen = S.select(L.list(lib), sel, now());
		if (bag && bagKey === key) { bag = S.bagSync(bag, chosen, bagRand).bag; return saveBag(); }
		var load = thumb ? Promise.resolve(null) : store.get(key, null);
		return load.then(function (saved) {
			bag = saved && saved.order ? S.bagSync(saved, chosen, bagRand).bag : S.bagCreate(chosen, bagRand);
			bagKey = key;
			return saveBag();
		});
	}
	// The parts in the bag of the run the track belongs to, in part order;
	// null when it is in no run, or in one too long to keep together.
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
		var out = [], lim = limitsOf(plan), guard = 0;
		while (bag && out.length < k && guard++ < 10000) {
			if (lim.maxTracks && session.count >= lim.maxTracks) break;
			var r = S.bagNext(bag, bagRand);
			if (r.id == null) break;
			if (plan.keepRuns) {
				// numbered parts of one work: the run plays where its first part falls
				var members = runMembers(r.bag, r.id);
				if (members) {
					var rr = S.bagRunDraw(r.bag, members);
					if (rr.id == null) { bag = rr.bag; continue; }
					r = rr;
				}
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
	// Tracks drawn from the bag but never played go back among what is left.
	function returnToBag(ids) {
		if (!bag || !ids.length) return;
		var drawn = {}, back = [];
		S.bagPlayed(bag).forEach(function (id) { drawn[id] = true; });
		ids.forEach(function (id) { if (drawn[id] && back.indexOf(id) < 0) back.push(id); });
		if (!back.length) return;
		bag = S.bagReturn(bag, back, bagRand);
		session.count = Math.max(0, session.count - back.length);
		saveBag();
	}

	// ---- Plans -------------------------------------------------------------------------------

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
		var built = S.build(L.list(lib), {
			select: selectOf(plan), mode: plan.mode, blockSize: +plan.blockSize || 3, keepRuns: !!plan.keepRuns,
			limits: limitsOf(plan), seed: thumb ? 'thumb' : undefined
		}, { now: now(), after: cur ? S.artistKey(cur) : undefined });
		return built.order;
	}
	var lastPlanSig = '';
	// Apply the listening choices: the track that is on stays, what follows is new.
	function applyPlan(opts) {
		opts = opts || {};
		if (!thumb) store.set('plan', plan);
		session = { count: 0, seconds: 0 };
		lastPlanSig = S.signature(plan);
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
			renderListen();
			if (opts.say) setStatus(opts.say);
		}).catch(fail);
	}
	var applySoon = later(function () { applyPlan({}); }, 350);

	// ---- After changes ---------------------------------------------------------------------------

	function afterQueueChange() {
		renderNow();
		renderQueue();
		renderSentence();
		renderTransport();
	}
	// The three redraws run as three tasks, and the pickers reuse the facets
	// the library view just counted: at 10,000 tracks one task doing all of it
	// held the page for a tenth of a second or more.
	var libDirty = later(function () {
		renderLibrary();
		setTimeout(function () {
			renderNumbers();
			setTimeout(function () { renderListenPickers(true); }, 0);
		}, 0);
	}, 400);
	function saveIds(ids) {
		var list = [];
		(ids || []).forEach(function (id) { if (lib.tracks[id]) list.push(lib.tracks[id]); });
		return store.putTracks(list);
	}
	function saveMeta() { return store.saveLibraryMeta(L.meta(lib)); }
	function changed(ids, meta) {
		var p = saveIds(ids);
		if (meta) p = p.then(saveMeta);
		if (plan.mode === 'true' && bag) ensureBag();
		renderNow();
		renderQueue();
		libDirty();
		return p.catch(fail);
	}

	// ---- Now playing -----------------------------------------------------------------------------

	function renderNow() {
		var id = ctl ? ctl.current() : null, t = id ? lib.tracks[id] : null;
		$('now-title').textContent = t ? trackTitle(t) : (L.list(lib).length ? 'Nothing in the queue' : 'Nothing loaded');
		var bits = [];
		if (t) {
			bits.push(trackArtist(t));
			if (!t.artist && !t.artistGuess && t.guess && t.guess.artist) bits.push('perhaps ' + t.guess.artist + '?');
			if (t.versionText) bits.push(t.versionText);
			if (t.year) bits.push(t.yearSource === 'upload' ? 'uploaded ' + t.year : String(t.year));
			if (t.durationSec) bits.push(clock(t.durationSec));
		}
		$('now-artist').textContent = bits.join(' ' + DOT + ' ');
		var chips = $('now-chips');
		clear(chips);
		if (t) {
			(t.genres.length ? t.genres : []).forEach(function (g) {
				var on = plan.genres.length === 1 && plan.genres[0] === g;
				var b = btn('kit-chip', g);
				b.setAttribute('aria-pressed', on ? 'true' : 'false');
				b.title = on ? 'Back to every genre' : 'Hear only ' + g;
				b.addEventListener('click', function () {
					plan.genres = on ? [] : [g];
					applyPlan({ say: on ? 'Every genre again.' : 'Only ' + g + ' from here on.' });
				});
				chips.appendChild(b);
			});
			if (!t.genres.length) chips.appendChild(el('span', 'kit-note', 'No genre known'));
			guessPicks(t).forEach(function (p) { chips.appendChild(p); });
		}
		var stars = $('now-stars');
		clear(stars);
		if (t) {
			for (var i = 1; i <= 5; i++) (function (k) {
				var b = btn('ts-star', STAR, 'Rate ' + k + ' of 5');
				b.setAttribute('aria-pressed', t.rating >= k ? 'true' : 'false');
				b.addEventListener('click', function () {
					var r = t.rating === k ? 0 : k;
					L.edit(lib, t.id, { rating: r });
					changed([t.id]);
					ToyKit.toast(r ? 'Rated ' + r + ' of 5.' : 'Rating removed.');
				});
				stars.appendChild(b);
			})(i);
		}
		var more = $('btn-more-artist');
		more.hidden = !t || !t.artistKey;
		if (t && t.artistKey) {
			var on = plan.artists.length === 1 && plan.artists[0] === t.artistKey;
			more.setAttribute('aria-pressed', on ? 'true' : 'false');
			more.textContent = on ? 'Every artist again' : 'More by ' + t.artist;
		}
		$('btn-fix').hidden = !t;
		$('btn-block').hidden = !t;
		if (t) $('btn-block').textContent = t.blocked ? 'Unblock' : 'Block';
		if (openFix && openFix.where === 'now' && openFix.id !== id) closeFixer();
		mediaSession(t);
		$('poster-text') && ($('poster-text').textContent = t ? (demo ? 'Press play (demo, no sound)' : 'Press play to load YouTube\'s player') : 'Nothing to play yet');
	}

	function renderTransport() {
		var st = player ? player.state() : 'idle', playing = st === 'playing' || st === 'loading';
		var b = $('btn-toggle');
		b.classList.toggle('is-playing', playing);
		b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
		var s = ctl ? ctl.state() : null;
		$('btn-prev').disabled = !s || s.index <= 0;
		$('btn-next').disabled = !s || !s.items.length || s.index >= s.items.length;
		$('btn-toggle').disabled = !s || !s.items.length;
		if ('mediaSession' in navigator && !thumb) { try { navigator.mediaSession.playbackState = playing ? 'playing' : (st === 'paused' ? 'paused' : 'none'); } catch (e) { /* not supported */ } }
	}

	function togglePlay() {
		if (!ctl) return;
		var s = ctl.state();
		if (!s.items.length || s.done) { applyPlan({ play: true }); return; }
		ctl.toggle();
		renderTransport();
	}
	function goNext() { if (ctl) ctl.next(); }
	function goPrev() {
		if (!ctl) return;
		if (player.time().current > 5 && player.state() !== 'idle') { player.seek(0); return; }
		ctl.previous();
	}
	function reshuffle() { applyPlan({ reshuffle: true, say: 'Shuffled again.' }); }

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
			if (t && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: trackTitle(t), artist: trackArtist(t), album: demo ? 'True Shuffle demo' : 'True Shuffle' });
		} catch (e) { /* the browser does not hand these buttons to the page */ }
	}

	// ---- Listening choices ----------------------------------------------------------------------

	var ORDER_KEYS = ['true', 'spread', 'fresh', 'favourites', 'neglected', 'artists', 'genres', 'newest', 'original'];
	function renderListen() {
		var box = $('order-chips');
		clear(box);
		ORDER_KEYS.forEach(function (k) {
			var m = modeInfo(k), b = btn('kit-chip ts-mode', m.name);
			b.setAttribute('aria-pressed', plan.mode === k ? 'true' : 'false');
			b.dataset.mode = k;
			b.addEventListener('click', function () {
				if (plan.mode === k) return;
				plan.mode = k;
				applyPlan({ say: m.name + ' from the next track on.' });
			});
			box.appendChild(b);
		});
		$('order-blurb').textContent = modeInfo(plan.mode).blurb;
		$('block-size-row').hidden = plan.mode !== 'genres';
		$('lim-tracks').value = plan.maxTracks || '';
		$('lim-minutes').value = plan.maxMinutes || '';
		$('lim-hours').value = plan.hours || '';
		$('keep-runs').checked = !!plan.keepRuns;
		$('block-size').value = plan.blockSize || 3;
		renderListenPickers();
		renderPresets();
		renderSentence();
	}

	function facetName(kind, key) {
		if (kind === 'playlists') return (lib.playlists[key] && lib.playlists[key].title) || key;
		if (kind === 'artists') { var f = facetsCache().artist; for (var i = 0; i < f.length; i++) if (f[i].key === key) return f[i].name; return key || 'Unknown artist'; }
		if (kind === 'lengths') { for (var j = 0; j < L.LENGTH_CLASSES.length; j++) if (L.LENGTH_CLASSES[j].key === key) return L.LENGTH_CLASSES[j].name; }
		return key || 'Unknown';
	}
	var facetMemo = null;
	function facetsCache() { if (!facetMemo) facetMemo = L.facets(lib, L.list(lib), now()); return facetMemo; }

	var artistFilter = '';
	function pickGroup(boxId, title, kind, entries, opts) {
		opts = opts || {};
		var box = $(boxId);
		clear(box);
		if (!entries.length) { box.hidden = true; return; }
		box.hidden = false;
		var head = el('div', 'ts-pick-head');
		head.appendChild(el('h3', 'ts-pick-title', title));
		if (opts.search) {
			var inp = el('input', 'kit-input ts-pick-find');
			inp.type = 'search';
			inp.placeholder = 'Find an artist';
			inp.setAttribute('aria-label', 'Find an artist');
			inp.value = artistFilter;
			inp.addEventListener('input', function () { artistFilter = inp.value; drawChips(); });
			head.appendChild(inp);
		}
		box.appendChild(head);
		var row = el('div', 'ts-chiprow');
		box.appendChild(row);
		function drawChips() {
			clear(row);
			var list = entries, shown = 0, f = artistFilter.trim().toLowerCase();
			if (opts.search && f) list = entries.filter(function (e) { return e.name.toLowerCase().indexOf(f) >= 0; });
			list.forEach(function (e) {
				var on = plan[kind].indexOf(e.key) >= 0;
				if (opts.max && shown >= opts.max && !on) return;
				shown++;
				var b = btn('kit-chip', e.name);
				b.appendChild(el('span', 'ts-count', String(e.count)));
				b.setAttribute('aria-pressed', on ? 'true' : 'false');
				b.addEventListener('click', function () {
					var at = plan[kind].indexOf(e.key);
					if (at >= 0) plan[kind].splice(at, 1); else plan[kind].push(e.key);
					b.setAttribute('aria-pressed', at >= 0 ? 'false' : 'true');
					summaries();
					applySoon();
				});
				row.appendChild(b);
			});
			if (opts.max && list.length > shown) row.appendChild(el('span', 'kit-note', 'and ' + n(list.length - shown) + ' more: type to find them'));
		}
		drawChips();
	}
	function renderListenPickers(fresh) {
		if (!fresh) facetMemo = null;
		var f = facetsCache();
		pickGroup('pick-playlists', 'Playlists', 'playlists', f.playlist);
		pickGroup('pick-genres', 'Genres', 'genres', f.genre.filter(function (e) { return e.key; }));
		pickGroup('pick-decades', 'Decades', 'decades', f.decade.filter(function (e) { return e.key; }));
		pickGroup('pick-artists', 'Artists', 'artists', f.artist.filter(function (e) { return e.key; }), { search: true, max: 24 });
		pickGroup('pick-lengths', 'Lengths', 'lengths', f.length.filter(function (e) { return e.count; }));
		summaries();
	}
	function whatWords(p) {
		var parts = [];
		['playlists', 'genres', 'decades', 'artists'].forEach(function (k) {
			if (p[k].length) parts.push(p[k].map(function (key) { return facetName(k, key); }).join(' or '));
		});
		return parts;
	}
	function limitWords(p) {
		var parts = [];
		if (p.maxTracks > 0) parts.push('stops after ' + plural(+p.maxTracks, 'track'));
		if (p.maxMinutes > 0) parts.push('stops after ' + longTime(p.maxMinutes * 60));
		if (p.hours > 0) parts.push('leaves out what played in the last ' + plural(+p.hours, 'hour'));
		if (p.lengths.length) parts.push(p.lengths.map(function (k) { return facetName('lengths', k).toLowerCase(); }).join(' or '));
		return parts;
	}
	function summaries() {
		var w = whatWords(plan);
		$('what-summary').textContent = w.length ? w.join('; ') : 'Everything';
		$('what-all').setAttribute('aria-pressed', w.length ? 'false' : 'true');
		var l = limitWords(plan);
		$('limits-summary').textContent = l.length ? l.join('; ') : 'None';
	}

	function renderSentence() {
		if (!ctl) return;
		var st = ctl.state(), up = S.upcoming(st), cur = ctl.current();
		var m = modeInfo(plan.mode), what = whatWords(plan), lim = limitWords(plan), text;
		var scope = what.length ? ' (' + what.join('; ') + ')' : '';
		if (!L.list(lib).length) { $('sentence').textContent = ''; return; }
		if (plan.mode === 'true' && bag) {
			var total = bag.order.length;
			var played = Math.max(0, bag.pos - up.length - (cur != null && bag.order.indexOf(cur) >= 0 && bag.order.indexOf(cur) < bag.pos ? 1 : 0));
			text = 'True shuffle of ' + plural(total, 'track') + scope + '; ' + n(played) + ' played, ' + n(total - played) + ' left in this round' + (bag.cycle > 1 ? ' (round ' + bag.cycle + ')' : '') + '.';
		} else {
			var secs = 0;
			up.forEach(function (id) { secs += (lib.tracks[id] && lib.tracks[id].durationSec) || 0; });
			var count = chosenTracks().length;
			text = m.name + ' of ' + plural(count, 'track') + scope + '; ' + n(up.length) + ' to come' + (secs ? ', about ' + longTime(secs) : '') + '.';
		}
		if (lim.length) text += ' It ' + lim.join(', ') + '.';
		if (!st.items.length) text = 'Nothing matches these choices. Take one away under ' + q('What') + ' or ' + q('Limits') + '.';
		$('sentence').textContent = text;
	}

	function renderPresets() {
		var box = $('preset-list');
		clear(box);
		presets.forEach(function (p, i) {
			var wrap = el('span', 'ts-preset');
			var b = btn('kit-chip', p.name);
			b.addEventListener('click', function () {
				plan = copyPlan(p.plan);
				applyPlan({ say: 'Preset ' + q(p.name) + '.' });
			});
			var x = btn('ts-x', TIMES, 'Delete preset ' + p.name);
			x.addEventListener('click', function () {
				presets.splice(i, 1);
				store.set('presets', presets);
				renderPresets();
			});
			wrap.appendChild(b);
			wrap.appendChild(x);
			box.appendChild(wrap);
		});
		$('presets-summary').textContent = presets.length ? n(presets.length) + ' saved' : 'None saved';
		if (!presets.length) box.appendChild(el('span', 'kit-note', 'Choices you name are kept here.'));
	}

	function wireListen() {
		$('what-all').addEventListener('click', function () {
			['playlists', 'genres', 'decades', 'artists'].forEach(function (k) { plan[k] = []; });
			renderListenPickers();
			applyPlan({ say: 'Everything again.' });
		});
		function numInput(id, key) {
			$(id).addEventListener('change', function () {
				var v = parseInt($(id).value, 10);
				plan[key] = v > 0 ? v : null;
				summaries();
				applySoon();
			});
		}
		numInput('lim-tracks', 'maxTracks');
		numInput('lim-minutes', 'maxMinutes');
		numInput('lim-hours', 'hours');
		$('keep-runs').addEventListener('change', function () { plan.keepRuns = $('keep-runs').checked; applySoon(); });
		$('block-size').addEventListener('change', function () { plan.blockSize = Math.max(1, Math.min(20, parseInt($('block-size').value, 10) || 3)); applySoon(); });
		$('btn-preset-save').addEventListener('click', function () {
			var name = $('preset-name').value.trim();
			if (!name) { $('preset-name').focus(); ToyKit.toast('Give the preset a name first.'); return; }
			presets = presets.filter(function (p) { return p.name !== name; });
			presets.push({ name: name, plan: copyPlan(plan) });
			store.set('presets', presets);
			$('preset-name').value = '';
			renderPresets();
			ToyKit.toast('Saved ' + q(name) + '.');
		});
		$('preset-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('btn-preset-save').click(); } });
	}

	// ---- The queue -------------------------------------------------------------------------------

	var QUEUE_SHOW = 60;
	var GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v3H8zM13 5h3v3h-3zM8 10.5h3v3H8zM13 10.5h3v3h-3zM8 16h3v3H8zM13 16h3v3h-3z"/></svg>';
	function trackLine(li, t) {
		var txt = el('span', 'ts-q-text');
		txt.appendChild(el('span', 'ts-q-title', trackTitle(t)));
		txt.appendChild(el('span', 'ts-q-artist', trackArtist(t) + (t && t.durationSec ? ' ' + DOT + ' ' + clock(t.durationSec) : '')));
		li.appendChild(txt);
		return txt;
	}
	function renderQueue() {
		var st = ctl.state(), list = $('queue'), up = S.upcoming(st), base = st.index + 1;
		clear(list);
		up.slice(0, QUEUE_SHOW).forEach(function (id, k) {
			var t = lib.tracks[id], at = base + k, li = el('li', 'ts-q');
			li.dataset.index = at;
			var grip = btn('ts-grip', null, 'Move ' + trackTitle(t) + ': drag, or arrow keys; Delete removes it');
			grip.innerHTML = GRIP;
			grip.dataset.index = at;
			li.appendChild(grip);
			var main = btn('ts-q-main', null, null);
			main.title = 'Play now';
			trackLine(main, t);
			main.addEventListener('click', function () { ctl.jump(at); });
			li.appendChild(main);
			var nx = btn('kit-btn small ts-q-next', 'Next', 'Play ' + trackTitle(t) + ' next');
			nx.hidden = k === 0;
			nx.addEventListener('click', function () { ctl.playNext([id]); });
			li.appendChild(nx);
			var x = btn('ts-x', TIMES, 'Remove ' + trackTitle(t) + ' from the queue');
			x.addEventListener('click', function () { ctl.remove(at); });
			li.appendChild(x);
			list.appendChild(li);
		});
		$('queue-more').textContent = up.length > QUEUE_SHOW ? 'and ' + n(up.length - QUEUE_SHOW) + ' more' : (up.length ? '' : (st.items.length ? 'Nothing after this track.' : 'The queue is empty.'));
		renderHistory();
	}
	function renderHistory() {
		var st = ctl.state(), list = $('history'), h = st.history.slice().reverse();
		clear(list);
		h.slice(0, 50).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t) return;
			var li = el('li', 'ts-q');
			var main = btn('ts-q-main', null, null);
			main.title = 'Play it next';
			trackLine(main, t);
			main.addEventListener('click', function () { ctl.playNext([id]); ToyKit.toast(trackTitle(t) + ' plays next.'); });
			li.appendChild(main);
			if (t.playerError) li.appendChild(el('span', 'ts-flag', 'skipped'));
			list.appendChild(li);
		});
		$('history-more').textContent = h.length ? (h.length > 50 ? 'The last 50 of ' + n(h.length) + '.' : '') : 'Nothing played yet in this queue.';
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
			drag = { from: +g.dataset.index, li: g.parentNode, to: +g.dataset.index, id: e.pointerId };
			drag.li.classList.add('is-drag');
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
		function end() {
			if (!drag) return;
			var d = drag;
			drag = null;
			if (d.to !== d.from) ctl.move(d.from, d.to); else renderQueue();
		}
		list.addEventListener('pointerup', end);
		list.addEventListener('pointercancel', function () { drag = null; renderQueue(); });

		var tabs = [$('tab-next'), $('tab-history')];
		function pick(i) {
			tabs.forEach(function (t, k) {
				t.setAttribute('aria-selected', k === i ? 'true' : 'false');
				t.tabIndex = k === i ? 0 : -1;
			});
			$('panel-next').hidden = i !== 0;
			$('panel-history').hidden = i !== 1;
		}
		tabs.forEach(function (t, i) {
			t.addEventListener('click', function () { pick(i); });
			t.addEventListener('keydown', function (e) {
				if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var k = 1 - i; pick(k); tabs[k].focus(); }
			});
		});
	}

	// ---- Fixing a track ------------------------------------------------------------------------

	// ---- Guesses -----------------------------------------------------------------------------
	// A track whose artist nothing vouches for shows its channel as the artist,
	// marked "guess", with one button per reading the parser saw: one tap
	// saves it, and the page offers to read the channel's other guesses the
	// same way (a channel rule learnt from that one answer).

	var SPLIT_RULES = { 'dash': 1, 'dash-guess': 1, 'known-artist': 1, 'dash-composer': 1, 'dash-title-artist': 1, 'dash-loose': 1, 'slash-title-artist': 1, 'slash-artist-title': 1, 'slash-guess': 1 };
	function guessPicks(t) {
		if (!t || t.artist || !t.artistGuess) return [];
		var g = t.guess || {}, out = [];
		if (g.artist) out.push(pickBtn(t, g.artist, g.title));
		if (g.artist && g.title && SPLIT_RULES[g.rule] && Parse.fold(g.title) !== Parse.fold(g.artist)) out.push(pickBtn(t, g.title, g.artist));
		if (!out.length) out.push(pickBtn(t, t.artistGuess, t.title));
		return out;
	}
	function pickBtn(t, artist, title) {
		var b = btn('kit-btn small ts-guesspick', 'By ' + artist + '?', 'The artist of ' + q(title) + ' is ' + artist + ': save that');
		b.addEventListener('click', function () { acceptGuess(t.id, artist, title, b.closest && b.closest('#now-chips') ? 'now' : 'lib'); });
		return b;
	}
	// Where keyboard focus goes once the library is drawn again: the next
	// guess after the track just settled, else that track's own row.
	var focusAfterDraw = null;
	function acceptGuess(id, artist, title, from) {
		var ck = L.channelKey(lib.tracks[id]);
		L.edit(lib, id, { artist: artist, title: title });
		// The answer names an artist for sure: the channel's other toss-ups
		// that it settles are read again now, so the offer below counts only
		// what is still unsure.
		var amb = L.ambiguousIds(lib).filter(function (x) { return x !== id && L.channelKey(lib.tracks[x]) === ck; });
		var settled = amb.length ? L.deriveIds(lib, amb).filter(function (x) { return lib.tracks[x].artist; }) : [];
		changed([id].concat(settled));
		setStatus('Saved: ' + q(title) + ' by ' + artist + '.' + (settled.length ? ' That also names the artist of ' + plural(settled.length, 'other track') + ' on this channel.' : ''));
		var offered = offerLearn(id, artist);
		if (offered) { offered.focus(); return; }
		if (from === 'now') { focusNowAfterPick(); return; }
		focusAfterDraw = { id: id };
	}
	function focusNowAfterPick() {
		var next = document.querySelector('#now-chips .ts-guesspick');
		var fix = $('btn-fix');
		if (next) next.focus(); else if (fix && !fix.hidden) fix.focus();
	}
	// Called at the end of renderLibrary.
	function placeFocus() {
		if (!focusAfterDraw) return;
		var id = focusAfterDraw.id, body = $('lib-body');
		focusAfterDraw = null;
		var rows = body.querySelectorAll('tr.ts-row'), at = -1, i;
		for (i = 0; i < rows.length; i++) if (rows[i].dataset.id === id) { at = i; break; }
		for (i = at + 1; i < rows.length; i++) {
			var pick = rows[i].querySelector('.ts-guesspick');
			if (pick) { pick.focus(); return; }
		}
		var own = at >= 0 ? rows[at].querySelector('.c-act .kit-btn:last-child') : null;
		if (own) own.focus();
	}
	function ruleWords(rule) {
		if (rule === 'artist-title') return 'as Artist - Title';
		if (rule === 'title-artist') return 'as Title - Artist';
		if (rule === 'channel') return 'with the channel as the artist';
		return 'as all by ' + (rule && rule.artist);
	}
	// The offer reads only the channel's other guesses: tracks with a sure
	// artist and tracks the user corrected are left as they are. It says how
	// many it will touch before, how many changed after, and one tap undoes
	// the whole teaching. -> the button to focus, or null when nothing is offered
	function offerLearn(id, artist) {
		var t = lib.tracks[id], box = $('learn-offer');
		if (!t || !box) return null;
		var plan = L.teachPlan(lib, id, artist);
		clear(box);
		if (!plan || !plan.ids.length) { box.hidden = true; return null; }
		var count = plural(plan.ids.length, 'other unsure track');
		box.appendChild(el('p', null, 'Read the ' + count + ' from ' + q(t.channel) + ' the same way, ' + ruleWords(plan.rule) + '? Tracks with a sure artist and your corrections stay as they are.'));
		if (plan.conflicts) box.appendChild(el('p', 'kit-note', 'Careful: ' + plural(plan.conflicts, 'sure track') + ' on this channel ' + (plan.conflicts === 1 ? 'is' : 'are') + ' written the other way round, so the channel mixes orders and some of these guesses may be read wrongly.'));
		var row = el('div', 'kit-row');
		var yes = btn('kit-btn small primary', plan.ids.length === 1 ? 'Yes, that track' : 'Yes, those ' + plural(plan.ids.length, 'track')), no = btn('kit-btn small', 'No');
		yes.addEventListener('click', function () {
			var res = L.teachChannel(lib, plan);
			changed(res.touched, true);
			var msg = 'The ' + count + ' from ' + q(t.channel) + ' ' + (plan.ids.length === 1 ? 'is' : 'are') + ' now read ' + ruleWords(plan.rule) + ': ' + plural(res.ids.length, 'track') + ' changed.';
			setStatus(msg);
			clear(box);
			box.appendChild(el('p', null, msg));
			var undoRow = el('div', 'kit-row');
			var undo = btn('kit-btn small', 'Undo this teaching'), done = btn('kit-btn small', 'Close');
			undo.addEventListener('click', function () {
				var back = L.setChannelRule(lib, plan.key, res.prev);
				changed(back, true);
				box.hidden = true;
				setStatus('Undone: ' + plural(res.ids.length, 'track') + ' from ' + q(t.channel) + ' back to guesses.');
				focusAfterDraw = { id: id };
			});
			done.addEventListener('click', function () { box.hidden = true; focusAfterDraw = { id: id }; libDirty(); });
			undoRow.appendChild(undo);
			undoRow.appendChild(done);
			box.appendChild(undoRow);
			undo.focus();
		});
		no.addEventListener('click', function () { box.hidden = true; focusAfterDraw = { id: id }; libDirty(); });
		row.appendChild(yes);
		row.appendChild(no);
		box.appendChild(row);
		box.hidden = false;
		return yes;
	}

	var CHANNEL_CHOICES = [
		['', 'Leave the other tracks as they are'],
		['learn', 'Read the whole channel the way I corrected this track'],
		['artist-title', 'Titles there read Artist - Title'],
		['title-artist', 'Titles there read Title - Artist (or Title / Artist)'],
		['channel', 'The channel name is the artist'],
		['fixed', 'Every track there is by the artist above'],
		['none', 'Never guess an artist there'],
		['forget', 'Forget what I taught about this channel']
	];
	function closeFixer() {
		if (!openFix) return;
		if (openFix.node && openFix.node.parentNode) openFix.node.parentNode.removeChild(openFix.node);
		if (openFix.where === 'now') { $('now-edit').hidden = true; clear($('now-edit')); }
		openFix = null;
	}
	function fixer(id, where) {
		var t = lib.tracks[id];
		var form = el('form', 'ts-fixform');
		form.setAttribute('aria-label', 'Correct ' + trackTitle(t));
		var raw = el('p', 'kit-note ts-raw');
		raw.textContent = 'YouTube title ' + q(t.raw.title) + ' on the channel ' + q(t.channel || 'unknown') + '. ' + (t.guess && t.guess.rule && Parse.RULES[t.guess.rule] ? 'Read as: ' + Parse.RULES[t.guess.rule] : '');
		form.appendChild(raw);
		var grid = el('div', 'ts-fixgrid');
		function field(label, value, type, list) {
			var lab = el('label', 'ts-field');
			lab.appendChild(el('span', null, label));
			var inp = el('input', 'kit-input');
			inp.type = type || 'text';
			inp.value = value == null ? '' : value;
			inp.autocomplete = 'off';
			if (list) inp.setAttribute('list', list);
			lab.appendChild(inp);
			grid.appendChild(lab);
			return inp;
		}
		var fa = field('Artist', t.artist), ft = field('Title', t.title), fg = field('Genres, separated by commas', t.genres.join(', '), 'text', 'genre-list'), fy = field('Year', t.year || '', 'number');
		fy.min = 1900; fy.max = 2100;
		if (!t.artist && t.guess && t.guess.artist) fa.placeholder = 'perhaps ' + t.guess.artist;
		form.appendChild(grid);
		var ck = L.channelKey(t), chCount = L.list(lib).filter(function (x) { return L.channelKey(x) === ck; }).length;
		var chLab = el('label', 'ts-field ts-chfield');
		chLab.appendChild(el('span', null, 'The whole channel ' + q(t.channel || 'unknown') + ' (' + plural(chCount, 'track') + ')'));
		var sel = el('select', 'kit-input');
		CHANNEL_CHOICES.forEach(function (c) { var o = el('option', null, c[1]); o.value = c[0]; sel.appendChild(o); });
		chLab.appendChild(sel);
		form.appendChild(chLab);
		var row = el('div', 'kit-row');
		var save = el('button', 'kit-btn small primary', 'Save');
		save.type = 'submit';
		var cancel = btn('kit-btn small', 'Cancel');
		row.appendChild(save);
		row.appendChild(cancel);
		if (Object.keys(t.userEdits).length) {
			var undo = btn('kit-btn small', 'Undo my corrections');
			undo.addEventListener('click', function () {
				L.edit(lib, id, { title: null, artist: null, version: null, year: null, genres: null });
				closeFixer();
				changed([id], false);
				setStatus('Back to what was read from YouTube for ' + q(trackTitle(t)) + '.');
			});
			row.appendChild(undo);
		}
		form.appendChild(row);
		cancel.addEventListener('click', closeFixer);
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var fields = {}, ids = [id], meta = false, ch = sel.value;
			if (ft.value.trim() !== t.title) fields.title = ft.value.trim() || null;
			if (fa.value.trim() !== t.artist && ch !== 'fixed') fields.artist = fa.value.trim() || null;
			var genres = fg.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
			if (genres.join('|') !== t.genres.join('|')) fields.genres = genres.length ? genres : null;
			if (String(fy.value) !== String(t.year || '')) fields.year = fy.value ? +fy.value : null;
			var said = [];
			if (Object.keys(fields).length) { L.edit(lib, id, fields); said.push('Saved.'); }
			if (ch) {
				if ((ch === 'fixed' || ch === 'learn') && !fa.value.trim()) { fa.focus(); ToyKit.toast('Type the artist first.'); return; }
				var rule = ch === 'forget' ? null : ch === 'fixed' ? { artist: fa.value.trim() } : ch === 'learn' ? L.learnRule(lib, id, fa.value.trim()) : ch;
				var before = {};
				L.list(lib).forEach(function (x) { if (L.channelKey(x) === ck) before[x.id] = x.artist + '|' + x.title; });
				var chIds = L.setChannelRule(lib, ck, rule);
				var moved = chIds.filter(function (x) { return before[x] !== lib.tracks[x].artist + '|' + lib.tracks[x].title; }).length;
				ids = ids.concat(chIds);
				meta = true;
				said.push('The channel ' + q(t.channel) + ': ' + plural(moved, 'track') + ' now read differently.');
			}
			closeFixer();
			changed(ids, meta);
			setStatus(said.join(' ') || 'Nothing changed.');
		});
		return form;
	}
	function openFixer(id, where, anchorRow) {
		closeFixer();
		var form = fixer(id, where);
		if (where === 'now') {
			var box = $('now-edit');
			clear(box);
			box.appendChild(form);
			box.hidden = false;
			openFix = { id: id, where: where, node: null };
		} else {
			var tr = el('tr', 'ts-fixrow'), td = el('td');
			td.colSpan = 7;
			td.appendChild(form);
			tr.appendChild(td);
			anchorRow.parentNode.insertBefore(tr, anchorRow.nextSibling);
			openFix = { id: id, where: where, node: tr };
		}
		var first = form.querySelector('input');
		if (first) first.focus();
	}

	// ---- The library ---------------------------------------------------------------------------

	var dupMemo = null;
	function dupIds() {
		if (dupMemo) return dupMemo;
		var m = {};
		L.duplicates(lib).forEach(function (g) { g.ids.forEach(function (id) { m[id] = g.key; }); });
		return (dupMemo = m);
	}
	function goneWhy(t) {
		if (t.removed) return t.removedReason === 'gone' ? 'Gone from YouTube' : 'Removed or private';
		if (t.embeddable === false) return 'Cannot be embedded';
		if (t.playerError) return 'Player error ' + t.playerError.code;
		return '';
	}
	function groupKeys(t, by) {
		// guesses group by their channel, so one box selects a channel's guesses
		if (by === 'artist') return [[t.artistKey || (t.artistGuess ? t.spreadKey : ''), trackArtist(t)]];
		if (by === 'genre') return t.genres.length ? t.genres.map(function (g) { return [g, g]; }) : [['', 'Unknown genre']];
		if (by === 'decade') return [[t.decade, t.decade || 'Unknown year']];
		if (by === 'playlist') return t.playlists.length ? t.playlists.map(function (p) { return [p, (lib.playlists[p] && lib.playlists[p].title) || p]; }) : [['', 'In no playlist']];
		if (by === 'channel') return [[L.channelKey(t), t.channel || 'Unknown channel']];
		return [['', '']];
	}
	// one collator for every sort: String.localeCompare builds one per call
	var collator = window.Intl && Intl.Collator ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
	function cmp(a, b) { return collator ? collator.compare(a, b) : a.localeCompare(b); }
	var SORTS = {
		title: function (a, b) { return cmp(trackTitle(a), trackTitle(b)); },
		artist: function (a, b) { return cmp(trackArtist(a), trackArtist(b)) || cmp(trackTitle(a), trackTitle(b)); },
		plays: function (a, b) { return b.plays - a.plays || SORTS.title(a, b); },
		least: function (a, b) { return a.plays - b.plays || SORTS.title(a, b); },
		rating: function (a, b) { return (b.rating || 0) - (a.rating || 0) || SORTS.title(a, b); },
		length: function (a, b) { return (b.durationSec || 0) - (a.durationSec || 0); },
		added: function (a, b) { return (L.lastAdded(b) || 0) - (L.lastAdded(a) || 0); },
		year: function (a, b) { return (a.year || 9999) - (b.year || 9999) || SORTS.title(a, b); }
	};
	function filteredTracks() {
		var show = $('lib-show').value, qtext = $('lib-search').value.trim(), dups = dupIds();
		var list = L.list(lib).filter(function (t) {
			if (show === 'never') return !t.plays;
			if (show === 'unknown') return !t.artistKey;
			if (show === 'edited') return Object.keys(t.userEdits).length > 0;
			if (show === 'blocked') return t.blocked;
			if (show === 'dups') return !!dups[t.id];
			if (show === 'gone') return !L.playable(t);
			return true;
		});
		if (qtext) return L.search(lib, qtext, list);
		return list.sort(SORTS[$('lib-sort').value] || SORTS.title);
	}
	function renderLibrary() {
		dupMemo = null;
		facetMemo = null;
		var all = L.list(lib), body = $('lib-body'), by = $('lib-group').value, show = $('lib-show').value;
		closeFixer();
		$('library').hidden = !all.length;
		$('lib-count').textContent = plural(all.length, 'track') + ' ' + DOT + ' ' + plural(facetsCache().artist.filter(function (a) { return a.key && !a.guess; }).length, 'artist') + (demo ? ' ' + DOT + ' invented' : '');
		renderReports();
		var list = filteredTracks();
		if (show === 'dups') by = 'dup';
		var groups = [], gmap = {};
		list.forEach(function (t) {
			var keys = by === 'dup' ? [[dupIds()[t.id], trackArtist(t) + ' ' + NDASH + ' ' + trackTitle(t)]] : groupKeys(t, by);
			keys.forEach(function (k) {
				var g = gmap[k[0]];
				if (!g) { g = gmap[k[0]] = { key: k[0], name: k[1], tracks: [] }; groups.push(g); }
				g.tracks.push(t);
			});
		});
		if (by !== 'none' && by !== 'dup' && !$('lib-search').value.trim()) {
			groups.sort(function (a, b) {
				if (!a.key !== !b.key) return a.key ? -1 : 1;
				if (by === 'decade') return a.key < b.key ? -1 : 1;
				return cmp(a.name, b.name);
			});
		}
		clear(body);
		var shown = 0;
		$('lib-note').hidden = !!list.length;
		$('lib-note').textContent = list.length ? '' : 'Nothing here.';
		for (var gi = 0; gi < groups.length && shown < libLimit; gi++) {
			var g = groups[gi];
			if (by !== 'none') body.appendChild(groupRow(g));
			for (var i = 0; i < g.tracks.length && shown < libLimit; i++) { body.appendChild(trackRow(g.tracks[i], show === 'gone')); shown++; }
		}
		var total = 0;
		groups.forEach(function (g) { total += g.tracks.length; });
		$('lib-more').hidden = shown >= total;
		$('lib-more').textContent = 'Show more (' + n(total - shown) + ' left)';
		renderBulk();
		$('genre-list').textContent = '';
		facetsCache().genre.forEach(function (gg) { if (gg.key) { var o = el('option'); o.value = gg.key; $('genre-list').appendChild(o); } });
		placeFocus();
	}
	function groupRow(g) {
		var tr = el('tr', 'ts-group'), th = el('th');
		th.colSpan = 7;
		th.scope = 'rowgroup';
		var lab = el('label', 'ts-groupsel');
		var cb = el('input');
		cb.type = 'checkbox';
		cb.checked = g.tracks.every(function (t) { return selected[t.id]; });
		cb.setAttribute('aria-label', 'Select every track of ' + (g.name || 'this group'));
		cb.addEventListener('change', function () {
			g.tracks.forEach(function (t) { if (cb.checked) selected[t.id] = true; else delete selected[t.id]; });
			renderLibrary();
		});
		lab.appendChild(cb);
		lab.appendChild(el('span', 'ts-group-name', g.name || 'Unknown'));
		lab.appendChild(el('span', 'ts-count', String(g.tracks.length)));
		th.appendChild(lab);
		tr.appendChild(th);
		return tr;
	}
	function trackRow(t, goneView) {
		var tr = el('tr', 'ts-row'), why = goneWhy(t);
		tr.dataset.id = t.id;
		if (t.blocked) tr.classList.add('is-blocked');
		if (why) tr.classList.add('is-gone');
		if (ctl && ctl.current() === t.id) tr.classList.add('is-now');
		var c0 = el('td', 'c-check'), cb = el('input');
		cb.type = 'checkbox';
		cb.checked = !!selected[t.id];
		cb.setAttribute('aria-label', 'Select ' + trackTitle(t));
		cb.addEventListener('change', function () { if (cb.checked) selected[t.id] = true; else delete selected[t.id]; renderBulk(); });
		var hit = el('label', 'ts-cbhit');   // a 44 px target around the box on a phone
		hit.appendChild(cb);
		c0.appendChild(hit);
		tr.appendChild(c0);
		var c1 = el('td', 'c-main');
		c1.appendChild(el('span', 'ts-r-title', trackTitle(t)));
		var sub = el('span', 'ts-r-sub', trackArtist(t) + (t.versionText ? ' ' + DOT + ' ' + t.versionText : '') + (t.year ? ' ' + DOT + ' ' + t.year : ''));
		c1.appendChild(sub);
		var flags = [];
		if (!t.artistKey && !t.artistGuess) flags.push(t.guess && t.guess.artist ? 'artist unsure' : 'no artist');
		if (Object.keys(t.userEdits).length) flags.push('corrected');
		if (t.blocked) flags.push('blocked');
		if (why) flags.push(why.toLowerCase());
		if (dupIds()[t.id]) flags.push('duplicate');
		var picks = guessPicks(t);
		if (flags.length || goneView || picks.length) {
			var fl = el('span', 'ts-flags');
			if (picks.length) fl.appendChild(el('span', 'ts-flag ts-flag-guess', 'guess'));
			picks.forEach(function (p) { fl.appendChild(p); });
			flags.forEach(function (f) { fl.appendChild(el('span', 'ts-flag', f)); });
			if (goneView || why) fl.appendChild(el('span', 'ts-r-chan', t.channel ? 'channel ' + t.channel : ''));
			c1.appendChild(fl);
		}
		tr.appendChild(c1);
		tr.appendChild(el('td', 'c-genres', t.genres.join(', ')));
		tr.appendChild(el('td', 'c-len', t.durationSec ? clock(t.durationSec) : ''));
		tr.appendChild(el('td', 'c-plays', String(t.plays)));
		var rate = el('td', 'c-rate', t.rating ? new Array(t.rating + 1).join(STAR) : '');
		if (t.rating) rate.setAttribute('aria-label', t.rating + ' of 5');
		tr.appendChild(rate);
		var c6 = el('td', 'c-act');
		var nx = btn('kit-btn small', 'Next', 'Play ' + trackTitle(t) + ' next');
		nx.disabled = !L.playable(t);
		nx.addEventListener('click', function () { queueNext([t.id]); });
		var fx = btn('kit-btn small', 'Fix', 'Correct ' + trackTitle(t));
		fx.addEventListener('click', function () {
			if (openFix && openFix.id === t.id && openFix.where === 'lib') { closeFixer(); return; }
			openFixer(t.id, 'lib', tr);
		});
		c6.appendChild(nx);
		c6.appendChild(fx);
		tr.appendChild(c6);
		return tr;
	}
	function queueNext(ids) {
		ids = ids.filter(function (id) { return lib.tracks[id] && L.playable(lib.tracks[id]); });
		if (!ids.length) { ToyKit.toast('Nothing playable in that choice.'); return; }
		if (ctl.current() == null) setQueue(ids, false); else ctl.playNext(ids);
		ToyKit.toast(ids.length === 1 ? trackTitle(lib.tracks[ids[0]]) + ' plays next.' : plural(ids.length, 'track') + ' play next.');
	}
	function renderReports() {
		var box = $('lib-reports'), s = L.stats(lib, now()), show = $('lib-show').value;
		var dups = L.duplicates(lib), m = {};
		dups.forEach(function (g) { g.ids.forEach(function (id) { m[id] = g.key; }); });
		dupMemo = m;   // the rows' "duplicate" flags read the same groups
		clear(box);
		[
			['gone', s.tracks - s.playable, 'gone or cannot be embedded'],
			['dups', dups.length, 'songs present more than once'],
			['unknown', s.unknownArtist, 'with no sure artist'],
			['never', s.neverPlayed, 'never played'],
			['edited', s.edited, 'corrected by you']
		].forEach(function (r) {
			if (!r[1]) return;
			var b = btn('kit-chip', n(r[1]) + ' ' + r[2]);
			b.setAttribute('aria-pressed', show === r[0] ? 'true' : 'false');
			b.addEventListener('click', function () { $('lib-show').value = show === r[0] ? 'all' : r[0]; libLimit = 150; renderLibrary(); });
			box.appendChild(b);
		});
	}

	// ---- Bulk edits -------------------------------------------------------------------------------

	var bulkAction = null;
	function selIds() { return Object.keys(selected).filter(function (id) { return lib.tracks[id]; }); }
	function renderBulk() {
		var ids = selIds();
		$('bulk').hidden = !ids.length;
		$('bulk-count').textContent = plural(ids.length, 'track') + ' selected';
		document.querySelector('[data-bulk="retry"]').hidden = !ids.some(function (id) { return lib.tracks[id].playerError; });
		if (!ids.length) { $('bulk-form').hidden = true; bulkAction = null; }
	}
	function wireBulk() {
		$('bulk').addEventListener('click', function (e) {
			var b = e.target.closest && e.target.closest('[data-bulk]');
			if (!b) return;
			var act = b.dataset.bulk, ids = selIds();
			if (act === 'clear') { selected = {}; renderLibrary(); return; }
			if (act === 'next') { queueNext(ids); return; }
			if (act === 'queue') {
				var ok = ids.filter(function (id) { return L.playable(lib.tracks[id]); });
				if (ctl.current() == null) setQueue(ok, false); else ctl.enqueue(ok);
				ToyKit.toast(plural(ok.length, 'track') + ' added to the queue.');
				return;
			}
			if (bulkBusy) return;
			if (act === 'block' || act === 'unblock') {
				inSlices(ids, act === 'block' ? 'Blocking' : 'Unblocking', function (part) { L.editMany(lib, part, { blocked: act === 'block' }); }).then(function () {
					changed(ids);
					setStatus(plural(ids.length, 'track') + (act === 'block' ? ' blocked: they are left out of every shuffle.' : ' unblocked.'));
				}).catch(fail);
				return;
			}
			if (act === 'retry') {
				var c = L.clearPlayerErrors(lib, ids);
				changed(c);
				setStatus(plural(c.length, 'track') + ' will be tried again.');
				return;
			}
			openBulkForm(act, ids);
		});
		$('bulk-cancel').addEventListener('click', function () { $('bulk-form').hidden = true; bulkAction = null; });
		$('bulk-form').addEventListener('submit', function (e) {
			e.preventDefault();
			if (bulkBusy) return;
			var ids = selIds(), v = $('bulk-input').value.trim(), sv = $('bulk-select').value, meta = false, msg = '', work;
			// Every bulk edit reads what the library knows about artists once,
			// edits the tracks in slices with the page drawn in between, and
			// writes the changed tracks to the store in one transaction at the end.
			var touched = {};
			function note(list) { list.forEach(function (id) { touched[id] = true; }); }
			function settle() {
				// names the edit made sure can settle other tracks' toss-ups
				var amb = L.ambiguousIds(lib);
				return knownSliced().then(function (known) {
					return inSlices(amb, 'Checking the other tracks', function (part) { note(L.deriveIds(lib, part, known)); });
				});
			}
			if (bulkAction === 'artist') {
				if (!v) { $('bulk-input').focus(); return; }
				work = knownSliced().then(function (knownA) {
					return inSlices(ids, 'Setting the artist', function (part) { note(L.editMany(lib, part, { artist: v }, knownA)); });
				}).then(settle);
				msg = 'Artist set to ' + q(v) + ' on ' + plural(ids.length, 'track') + '.';
			} else if (bulkAction === 'genres') {
				var gs = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
				work = knownSliced().then(function (knownG) {
					return inSlices(ids, 'Setting genres', function (part) { note(L.editMany(lib, part, { genres: gs.length ? gs : null }, knownG)); });
				});
				msg = gs.length ? 'Genres set to ' + gs.join(', ') + ' on ' + plural(ids.length, 'track') + '.' : 'Genres back to YouTube\'s on ' + plural(ids.length, 'track') + '.';
			} else if (bulkAction === 'merge') {
				var names = artistsOf(ids);
				var todo = L.planAliases(lib, names.filter(function (name) { return name !== sv; }), sv);
				work = knownSliced().then(function (knownM) {
					return inSlices(todo, 'Merging', function (part) { note(L.deriveIds(lib, part, knownM)); });
				});
				meta = true;
				msg = names.length - 1 + ' other spelling' + (names.length === 2 ? '' : 's') + ' now count as ' + q(sv) + '.';
			} else if (bulkAction === 'rate') {
				work = inSlices(ids, 'Rating', function (part) { note(L.editMany(lib, part, { rating: +sv })); });
				msg = +sv ? plural(ids.length, 'track') + ' rated ' + sv + ' of 5.' : 'Ratings removed from ' + plural(ids.length, 'track') + '.';
			} else return;
			$('bulk-form').hidden = true;
			bulkAction = null;
			work.then(function () {
				setStatus(msg);
				return changed(Object.keys(touched), meta);
			}).then(function () { renderListenPickers(); }).catch(fail);
		});
	}

	// Run work(slice) over ids a few hundred at a time, yielding to the page
	// between slices and showing how far it has got. -> a promise
	// Slices of SLICE ids are worked through until BUDGET ms have gone, then
	// the page gets its turn: at 10,000 tracks no task holds it for long.
	var bulkBusy = false, SLICE = 100, BUDGET = 12;
	function clockMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
	function inSlices(ids, label, work) {
		var box = $('bulk-busy'), bar = $('bulk-progress'), text = $('bulk-busy-text'), at = 0, total = ids.length;
		bulkBusy = true;
		var showing = total > 4 * SLICE;
		if (showing) { box.hidden = false; bar.max = total || 1; bar.value = 0; text.textContent = label + ': 0 of ' + n(total); }
		return new Promise(function (resolve, reject) {
			function step() {
				try {
					var t0 = clockMs();
					do {
						var end = Math.min(total, at + SLICE);
						if (end > at) work(ids.slice(at, end));
						at = end;
					} while (at < total && clockMs() - t0 < BUDGET);
					if (showing) { bar.value = at; text.textContent = label + ': ' + n(at) + ' of ' + n(total); }
					if (at < total) { setTimeout(step, 0); return; }
					bulkBusy = false;
					box.hidden = true;
					resolve();
				} catch (e) { bulkBusy = false; box.hidden = true; reject(e); }
			}
			step();
		});
	}
	// What the library knows about artists (L.knownArtists), read in slices.
	// -> a promise of the lookup function
	function knownSliced() {
		var c = L.knownCollector(lib), all = Object.keys(lib.tracks);
		return inSlices(all, 'Reading the library', function (part) { c.add(part.map(function (id) { return lib.tracks[id]; })); }).then(function () { return c.result(); });
	}
	function artistsOf(ids) {
		var seen = {}, out = [];
		ids.forEach(function (id) { var t = lib.tracks[id]; if (t && t.artist && !seen[t.artistKey]) { seen[t.artistKey] = true; out.push(t.artist); } });
		return out;
	}
	function openBulkForm(act, ids) {
		var inp = $('bulk-input'), sel = $('bulk-select'), label = $('bulk-label');
		bulkAction = act;
		inp.hidden = act === 'merge' || act === 'rate';
		sel.hidden = !inp.hidden;
		clear(sel);
		inp.value = '';
		if (act === 'artist') label.textContent = 'Artist for these ' + plural(ids.length, 'track');
		if (act === 'genres') label.textContent = 'Genres, separated by commas (empty: YouTube\'s again)';
		if (act === 'merge') {
			var names = artistsOf(ids);
			if (names.length < 2) { ToyKit.toast('Select tracks of at least two artists to merge them.'); bulkAction = null; return; }
			label.textContent = 'Merge ' + names.length + ' artists into';
			names.forEach(function (nm) { var o = el('option', null, nm); o.value = nm; sel.appendChild(o); });
		}
		if (act === 'rate') {
			label.textContent = 'Rating';
			for (var i = 5; i >= 0; i--) { var o = el('option', null, i ? new Array(i + 1).join(STAR) + ' (' + i + ')' : 'No rating'); o.value = i; sel.appendChild(o); }
		}
		$('bulk-form').hidden = false;
		(inp.hidden ? sel : inp).focus();
	}

	function wireLibrary() {
		var redraw = function () { libLimit = 150; renderLibrary(); };
		$('lib-search').addEventListener('input', later(redraw, 200));
		$('lib-group').addEventListener('change', redraw);
		$('lib-sort').addEventListener('change', redraw);
		$('lib-show').addEventListener('change', redraw);
		$('lib-more').addEventListener('click', function () { libLimit += 300; renderLibrary(); });
	}

	// ---- Bringing music in -----------------------------------------------------------------------

	function renderQuota() {
		var units = quota && quota.day === Y.pacificDay(Date.now()) ? quota.units : 0;
		$('quota').textContent = demo ? '' : 'YouTube quota used today: ' + n(units) + ' of ' + n(TS.config.dailyQuota) + ' units';
	}
	function renderBring() {
		var signed = !demo && auth.signedIn(), configured = auth.configured();
		$('acct-demo').hidden = !demo;
		$('acct').hidden = demo;
		$('setup').hidden = configured;
		$('setup-origin').textContent = location.origin;
		$('setup-redirect').textContent = auth.redirectUri();
		$('client-id').value = ToyKit.load('clientId', '') || '';
		$('btn-signin').hidden = signed;
		$('btn-signin').disabled = !configured;
		$('btn-signout').hidden = !signed;
		$('welcome-signin').disabled = !configured;
		$('acct-who').textContent = signed ? 'Signed in' + (sources && sources.me ? ' as ' + sources.me.title : '') + ', read-only, for about ' + Math.max(1, Math.round(auth.secondsLeft() / 60)) + ' more minutes.' : (configured ? '' : 'Paste a client id first, or follow the steps above.');
		$('sources-box').hidden = !signed;
		$('btn-import').disabled = !!importing;
		$('btn-refresh').disabled = !!importing || !L.list(lib).length;
		$('btn-stop').hidden = !importing;
		$('btn-mb').disabled = !!mbJob || !L.list(lib).length;
		$('btn-mb-stop').hidden = !mbJob;
		renderSources();
		renderHave();
		renderQuota();
		renderStale();
		store.usage().then(function (u) {
			$('usage').textContent = 'Stored in this browser' + (store.kind === 'memory' ? ' (in memory only: ' + (store.reason || 'nothing will be kept') + ')' : '') + ': ' + plural(u.tracks, 'track') + ', ' + plural(u.playlists, 'playlist') + ', ' + plural(u.history, 'listen') + (u.bytes ? ', about ' + Math.max(1, Math.round(u.bytes / 1024)) + ' KB' : '') + '.';
		}).catch(function () { /* the note stays empty */ });
	}
	function renderSources() {
		var list = $('sources');
		clear(list);
		if (!sources) {
			var li = el('li', 'ts-src');
			var b = btn('kit-btn', 'List my playlists');
			b.id = 'btn-list';
			b.addEventListener('click', listSources);
			li.appendChild(b);
			li.appendChild(el('span', 'kit-note', '3 quota units'));
			list.appendChild(li);
			return;
		}
		sources.sources.forEach(function (s) {
			var li = el('li', 'ts-src'), lab = el('label');
			var cb = el('input');
			cb.type = 'checkbox';
			cb.value = s.id;
			cb.dataset.playlist = s.id;
			cb.checked = !!s.ticked;
			cb.addEventListener('change', function () { s.ticked = cb.checked; });
			lab.appendChild(cb);
			lab.appendChild(el('span', 'ts-src-name', s.title || s.id));
			var info = [];
			if (s.count != null) info.push(plural(s.count, 'video'));
			if (s.privacy) info.push(s.privacy);
			if (lib.playlists[s.id]) info.push('imported');
			if (s.pending) info.push('import interrupted: it goes on where it stopped');
			lab.appendChild(el('span', 'kit-note', info.join(' ' + DOT + ' ')));
			li.appendChild(lab);
			list.appendChild(li);
		});
	}
	function renderHave() {
		var pls = Object.keys(lib.playlists).map(function (k) { return lib.playlists[k]; });
		$('have-box').hidden = demo || !pls.length;
		var list = $('have');
		clear(list);
		var counts = facetsCache().playlist, byKey = {};
		counts.forEach(function (c) { byKey[c.key] = c.count; });
		pls.forEach(function (p) {
			var li = el('li', 'ts-src');
			li.appendChild(el('span', 'ts-src-name', p.title || p.id));
			var when = p.refreshedAt ? String(p.refreshedAt).slice(0, 10) : '';
			li.appendChild(el('span', 'kit-note', plural(byKey[p.id] || 0, 'track') + (p.unavailable ? ', ' + n(p.unavailable) + ' unavailable' : '') + (when ? ' ' + DOT + ' read ' + when : '')));
			var rm = btn('kit-btn small', 'Remove', 'Remove ' + (p.title || p.id) + ' from the library');
			rm.addEventListener('click', function () {
				var r = L.removePlaylist(lib, p.id, { dropOrphans: true });
				Promise.all([store.deletePlaylists([p.id]), store.deleteTracks(r.deleted), saveIds(r.changed), saveMeta()]).then(function () {
					setStatus('Removed ' + q(p.title) + ': ' + plural(r.deleted.length, 'track') + ' deleted; tracks you played, rated or corrected, or that are in another playlist, stay.');
					afterLibraryChange();
				}).catch(fail);
			});
			li.appendChild(rm);
			list.appendChild(li);
		});
	}
	function renderStale() {
		var s = L.list(lib).length && !demo ? L.stats(lib, now()) : null;
		var show = !!(s && s.staleCount && !auth.signedIn());
		$('stale').hidden = !show;
		if (show) $('stale-text').textContent = plural(s.staleCount, 'track') + ' carry YouTube details more than 30 days old. YouTube\'s terms ask for them to be refreshed or deleted: sign in and they are refreshed, or delete them under ' + q('Bring music in') + '.';
	}

	function listSources() {
		setStatus('Asking YouTube for your playlists' + ELL);
		return client.sources().then(function (r) {
			sources = r;
			return Promise.all(r.sources.map(function (s) { return Y.pendingImport(store, s.id).then(function (p) { s.pending = !!p; if (p) s.ticked = true; }); }));
		}).then(function () {
			setStatus('Signed in' + (sources.me ? ' as ' + sources.me.title : '') + '. ' + plural(sources.sources.length, 'list') + ' to choose from: tick some and press Import.');
			renderBring();
		}).catch(onApiError);
	}
	function onApiError(err) {
		if (err && err.code === 'signed-out') { auth.forget(); renderBring(); }
		fail(err);
	}
	function importTicked() {
		var picks = (sources ? sources.sources : []).filter(function (s) { return s.ticked; });
		if (!picks.length) { ToyKit.toast('Tick at least one list first.'); return; }
		var ctrl = window.AbortController ? new AbortController() : null;
		importing = { ctrl: ctrl };
		$('import-box').hidden = false;
		renderBring();
		var results = [];
		var chain = Promise.resolve();
		picks.forEach(function (s, i) {
			chain = chain.then(function () {
				return Y.importInto({
					client: client, lib: lib, store: store, playlist: s, signal: ctrl ? ctrl.signal : undefined,
					onProgress: function (pr) {
						var bar = $('import-progress'), txt;
						if (pr.phase === 'list') { bar.max = pr.total || 1; bar.value = pr.listed; txt = 'listed ' + n(pr.listed) + ' of ' + n(pr.total || 0); }
						else if (pr.phase === 'details') { bar.max = pr.toDetail || 1; bar.value = pr.detailed; txt = 'details ' + n(pr.detailed) + ' of ' + n(pr.toDetail || 0) + ' batches'; }
						else { bar.max = 1; bar.value = 1; txt = 'done'; }
						$('import-text').textContent = (i + 1) + ' of ' + picks.length + ': ' + q(s.title) + ', ' + txt + ', ' + plural(pr.quota, 'quota unit') + '.';
					}
				}).then(function (r) {
					s.pending = false;
					results.push(r);
					setStatus('Imported ' + q(r.title) + ': ' + n(r.total) + ' items, ' + n(r.unique) + ' videos, ' + n(r.added.length) + ' new, ' + n(r.missing.length) + ' no longer available, ' + plural(r.quota, 'quota unit') + (r.resumed ? ' (resumed)' : '') + '.');
					afterLibraryChange();
				});
			});
		});
		return chain.catch(function (err) {
			if (err && err.code === 'aborted') setStatus('Stopped. What was read is kept; Import goes on from there.');
			else onApiError(err);
		}).then(function () {
			importing = null;
			renderBring();
			if (results.length > 1) setStatus('Imported ' + plural(results.length, 'list') + ': ' + results.map(function (r) { return q(r.title) + ' (' + n(r.unique) + ')'; }).join(', ') + '.');
		});
	}
	function refreshAll(all) {
		if (importing) return Promise.resolve();
		var ctrl = window.AbortController ? new AbortController() : null;
		importing = { ctrl: ctrl };
		$('import-box').hidden = false;
		renderBring();
		return Y.refreshInto({
			client: client, lib: lib, store: store, all: !!all, signal: ctrl ? ctrl.signal : undefined, olderThanDays: TS.config.refreshDays,
			onProgress: function (pr) { $('import-progress').max = pr.total || 1; $('import-progress').value = pr.done; $('import-text').textContent = 'Refreshing: ' + n(pr.done) + ' of ' + n(pr.total) + ', ' + plural(pr.quota, 'quota unit') + '.'; }
		}).then(function (r) {
			setStatus('Refreshed ' + plural(r.checked, 'track') + ' from YouTube: ' + n(r.removed.length) + ' gone since, ' + n(r.restored.length) + ' back, ' + plural(r.quota, 'quota unit') + '.');
			return saveMeta();
		}).catch(onApiError).then(function () { importing = null; afterLibraryChange(); });
	}
	function afterLibraryChange() {
		facetMemo = null;
		dupMemo = null;
		var p = plan.mode === 'true' ? ensureBag() : Promise.resolve();
		return p.then(function () {
			var st = ctl.state();
			if (!st.items.length && L.list(lib).length) return applyPlan({});
		}).then(function () {
			renderAll();
		}).catch(fail);
	}

	function startMB() {
		var ctrl = window.AbortController ? new AbortController() : null;
		var mb = Y.createMusicBrainz({ endpoints: ep });
		var artists = facetsCache().artist.filter(function (a) { return a.key && !a.guess; });
		mbJob = { ctrl: ctrl };
		renderBring();
		mb.genresForArtists(artists, {
			lib: lib, signal: ctrl ? ctrl.signal : undefined,
			onProgress: function (p) { $('mb-text').textContent = n(p.done) + ' of ' + n(p.total) + ' artists (' + n(p.found || 0) + ' found)' + (p.name ? ': ' + p.name : ''); }
		}).then(function (r) {
			$('mb-text').textContent = 'Found genres for ' + plural(r.found, 'artist') + '; ' + n(r.notFound) + ' not found.';
			return changed(r.changed, true);
		}).catch(function (err) {
			$('mb-text').textContent = err && err.code === 'aborted' ? 'Stopped. Genres found so far are kept.' : (err.message || String(err));
			return saveMeta();
		}).then(function () { mbJob = null; renderBring(); renderListenPickers(); });
	}

	function exportAll() {
		store.exportAll(Date.now()).then(function (data) {
			ToyKit.download('true-shuffle-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
			setStatus('Exported ' + plural(data.tracks.length, 'track') + ', ' + plural(data.history.length, 'listen') + ' and your settings as one file.');
		}).catch(fail);
	}
	function importFile(file) {
		var reader = new FileReader();
		reader.onload = function () {
			var data;
			try { data = JSON.parse(String(reader.result)); } catch (e) { fail(new Error('That file is not JSON, so nothing was changed.')); return; }
			store.importAll(data, { mode: 'replace' }).then(reloadFromStore).then(function () {
				setStatus('Imported the file: ' + plural(L.list(lib).length, 'track') + '.');
			}).catch(fail);
		};
		reader.onerror = function () { fail(new Error('The file could not be read.')); };
		reader.readAsText(file);
	}
	function reloadFromStore() {
		return store.loadLibrary().then(function (parts) {
			lib = L.fromParts(parts);
			bag = null; bagKey = '';
			return loadSettings();
		}).then(function () {
			return startQueue();
		}).then(renderAll);
	}
	function wipe() {
		if (ctl) ctl.destroy();
		player.stop();
		store.wipe().then(function () {
			ToyKit.store('clientId', null);
			auth.setClientId(TS.config.clientId);
			lib = L.create();
			bag = null; bagKey = ''; presets = []; quota = null; selected = {};
			plan = copyPlan(DEFAULT_PLAN);
			ctl = null;
			makeController(S.queueInit());
			renderAll();
			setStatus('Everything stored here was deleted: library, corrections, ratings, history, queue, presets and the pasted client id. To also remove this page\'s access to your YouTube account, press Disconnect or visit myaccount.google.com/permissions.');
		}).catch(fail);
	}

	function wireBring() {
		$('btn-signin').addEventListener('click', signIn);
		$('welcome-signin').addEventListener('click', signIn);
		$('stale-signin').addEventListener('click', signIn);
		$('btn-signout').addEventListener('click', function () {
			auth.signOut().then(function (r) {
				sources = null;
				setStatus(r.revoked === true ? 'Disconnected: the access was revoked at Google and forgotten here.' : r.revoked === 'sent' ? 'Disconnected: the revocation was sent to Google and the access forgotten here.' : 'Disconnected here. Google could not be reached to revoke the access; it ends by itself within the hour, or remove it at myaccount.google.com/permissions.');
				renderBring();
			});
		});
		$('client-form').addEventListener('submit', function (e) {
			e.preventDefault();
			var v = $('client-id').value.trim();
			if (v && !/\.apps\.googleusercontent\.com$/.test(v)) { ToyKit.toast('A client id ends in .apps.googleusercontent.com.'); return; }
			ToyKit.store('clientId', v || null);
			auth.setClientId(v || TS.config.clientId);
			renderBring();
			setStatus(v ? 'This browser now signs in with that client id.' : 'Back to the client id set in config.js' + (TS.config.clientId ? '.' : ' (none).'));
		});
		$('btn-import').addEventListener('click', importTicked);
		$('btn-stop').addEventListener('click', function () { if (importing && importing.ctrl) importing.ctrl.abort(); });
		$('btn-refresh').addEventListener('click', function () { refreshAll(true); });
		$('btn-mb').addEventListener('click', startMB);
		$('btn-mb-stop').addEventListener('click', function () { if (mbJob && mbJob.ctrl) mbJob.ctrl.abort(); });
		$('btn-export').addEventListener('click', exportAll);
		$('import-file').addEventListener('change', function () { var f = $('import-file').files[0]; if (f) importFile(f); $('import-file').value = ''; });
		$('btn-wipe').addEventListener('click', function () { $('wipe-confirm').hidden = false; $('btn-wipe-no').focus(); });
		$('btn-wipe-no').addEventListener('click', function () { $('wipe-confirm').hidden = true; });
		$('btn-wipe-yes').addEventListener('click', function () { $('wipe-confirm').hidden = true; wipe(); });
	}
	function signIn() {
		if (demo) return;
		if (!auth.configured()) { location.hash = '#bring'; setStatus('Signing in needs a Google client id: see the steps under ' + q('Bring music in') + '.'); return; }
		setStatus('Going to Google to sign in' + ELL);
		auth.signIn().catch(fail);
	}

	// ---- Honest numbers -----------------------------------------------------------------------------

	function renderNumbers() {
		var s = L.stats(lib, now()), tiles = $('num-tiles');
		$('numbers').hidden = !s.tracks;
		clear(tiles);
		function tile(value, label) { var d = el('div', 'ts-tile'); d.appendChild(el('span', 'ts-tile-v', value)); d.appendChild(el('span', 'ts-tile-l', label)); tiles.appendChild(d); }
		tile(n(s.tracks), 'tracks, ' + n(s.playable) + ' playable');
		tile(n(s.neverPlayed), 'never played (' + (s.tracks ? Math.round(100 * s.neverPlayed / s.tracks) : 0) + '%)');
		tile(n(s.plays), 'plays, ' + n(s.skips) + ' skips');
		tile(n(s.artists), 'artists, ' + n(s.unknownArtist) + ' tracks unsure');
		tile(longTime(s.durationSec), 'to hear everything once');
		var chart = $('chart-plays'), table = $('chart-table'), max = 1;
		clear(chart);
		clear(table);
		s.playsHistogram.forEach(function (b) { max = Math.max(max, b.count); });
		s.playsHistogram.forEach(function (b) {
			var col = el('div', 'ts-bar');
			var fill = el('span', 'ts-bar-fill');
			fill.style.height = (b.count ? Math.max(2, Math.round(100 * b.count / max)) : 0) + '%';
			var val = el('span', 'ts-bar-v', n(b.count));
			col.appendChild(val);
			var well = el('span', 'ts-bar-well');
			well.appendChild(fill);
			col.appendChild(well);
			col.appendChild(el('span', 'ts-bar-l', b.label));
			chart.appendChild(col);
			var tr = el('tr');
			tr.appendChild(el('td', null, b.label));
			tr.appendChild(el('td', null, n(b.count)));
			tr.appendChild(el('td', null, (s.tracks ? Math.round(100 * b.count / s.tracks) : 0) + '%'));
			table.appendChild(tr);
		});
		var bagNote = plan.mode === 'true' && bag ? ' In this true-shuffle round ' + n(bag.pos) + ' of ' + n(bag.order.length) + ' tracks have been drawn; none comes again until all have.' : '';
		$('chart-note').textContent = 'How many tracks have been played how often (plays counted by this page: a track heard to the end or at least half way). An even shuffle moves the whole bar group to the right together.' + bagNote + (demo ? ' The demo\'s counts are invented.' : '');
	}

	// ---- Keys --------------------------------------------------------------------------------------

	function wireKeys() {
		document.addEventListener('keydown', function (e) {
			if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
			var tag = (e.target && e.target.tagName) || '';
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
			if (document.querySelector('.kit-backdrop:not([hidden])')) return;
			var k = e.key;
			if (k === ' ' || k === 'Spacebar') { if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return; e.preventDefault(); togglePlay(); }
			else if (k === 'n' || k === 'N') goNext();
			else if (k === 'p' || k === 'P') goPrev();
			else if (k === 's' || k === 'S') reshuffle();
			else if (k === '/') { e.preventDefault(); var s = $('lib-search'); s.scrollIntoView({ block: 'center' }); s.focus(); }
			else if ((k === 'ArrowRight' || k === 'ArrowLeft') && tag !== 'BUTTON' && player.state() !== 'idle') {
				e.preventDefault();
				var tm = player.time();
				player.seek(Math.max(0, Math.min(tm.duration || 0, tm.current + (k === 'ArrowRight' ? 10 : -10))));
			}
		});
	}

	function wireNow() {
		$('btn-toggle').addEventListener('click', togglePlay);
		$('btn-next').addEventListener('click', goNext);
		$('btn-prev').addEventListener('click', goPrev);
		$('btn-reshuffle').addEventListener('click', reshuffle);
		$('btn-more-artist').addEventListener('click', function () {
			var t = lib.tracks[ctl.current()];
			if (!t || !t.artistKey) return;
			var on = plan.artists.length === 1 && plan.artists[0] === t.artistKey;
			plan.artists = on ? [] : [t.artistKey];
			applyPlan({ say: on ? 'Every artist again.' : 'More by ' + t.artist + ' from here on.' });
		});
		$('btn-fix').addEventListener('click', function () {
			var id = ctl.current();
			if (!id) return;
			if (openFix && openFix.where === 'now') closeFixer(); else openFixer(id, 'now');
		});
		$('btn-block').addEventListener('click', function () {
			var id = ctl.current(), t = lib.tracks[id];
			if (!t) return;
			var block = !t.blocked;
			L.edit(lib, id, { blocked: block });
			changed([id]);
			if (block) { setStatus(q(trackTitle(t)) + ' is blocked: it is left out of every shuffle. Unblock it in the library.'); ctl.next(); }
			else setStatus(q(trackTitle(t)) + ' is unblocked.');
		});
		player.on('state', function () { renderTransport(); });
	}

	// ---- Start --------------------------------------------------------------------------------------

	function renderAll() {
		var has = L.list(lib).length > 0;
		$('welcome').hidden = demo || has;
		$('deck').hidden = !demo && !has;
		renderListen();
		renderNow();
		renderQueue();
		renderTransport();
		renderLibrary();
		renderNumbers();
		renderBring();
	}

	function loadSettings() {
		if (thumb) return Promise.resolve();
		return Promise.all([store.get('plan', null), store.get('presets', []), store.get('quota', null)]).then(function (r) {
			plan = copyPlan(r[0] || DEFAULT_PLAN);
			if (ORDER_KEYS.indexOf(plan.mode) < 0) plan.mode = 'true';
			presets = Array.isArray(r[1]) ? r[1] : [];
			quota = r[2];
		});
	}
	// The stored queue if there is one, else a new one from the plan. Nothing plays.
	function startQueue() {
		if (thumb) return thumbQueue();
		return store.get('queue', null).then(function (saved) {
			var ok = saved && Array.isArray(saved.items) && saved.items.length;
			if (ok) {
				var items = saved.items.filter(function (id) { return lib.tracks[id]; });
				var idx = Math.min(Math.max(-1, saved.index | 0), items.length);
				makeController({ items: items, index: items.length ? Math.max(0, Math.min(idx, items.length - 1)) : -1, history: (saved.history || []).filter(function (id) { return lib.tracks[id]; }), done: false, repeat: !!saved.repeat });
				queueMode = plan.mode;
				return plan.mode === 'true' ? ensureBag() : null;
			}
			makeController(S.queueInit());
			return L.list(lib).length ? applyPlan({}) : null;
		});
	}
	function thumbQueue() {
		return ensureBag().then(function () {
			var drawn = S.bagTake(bag, 31, bagRand);
			bag = drawn.bag;
			makeController({ items: drawn.ids, index: 23, history: drawn.ids.slice(0, 23), done: false, repeat: false });
			queueMode = 'true';
			ctl.resume();
			return Promise.resolve().then(function () { return Promise.resolve(); }).then(function () {
				var real = player.real();
				if (real && real.tick) real.tick(97000);
			});
		});
	}

	function start() {
		ToyKit.init({
			id: ID, title: 'True Shuffle',
			sub: demo ? 'Demo: an invented library and a player that only advances a clock.' : 'Your YouTube playlists, in the order you ask for.',
			back: 'misc', help: '#help-template'
		});
		if (demo) {
			$('demo-banner').hidden = false;
			$('demo-tag').hidden = false;
			document.documentElement.classList.add('is-demo');
		}
		player = lazyPlayer();
		wireListen();
		wireQueue();
		wireBulk();
		wireLibrary();
		wireBring();
		wireKeys();
		wireNow();
		auth.onChange(function () { if (store) renderBring(); });

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
			if (s.fallback) setStatus('This browser will not let the page keep data (' + (s.reason || 'storage refused') + '), so nothing will be remembered after this tab closes.');
			return s.loadLibrary().then(function (parts) { lib = L.fromParts(parts); });
		}).then(loadSettings).then(startQueue).then(function () {
			renderAll();
			if (thumb) { renderTransport(); }
			ToyKit.ready();
			if (demo && !thumb && !ToyKit.reducedMotion) setStatus('Demo: press play to watch the invented library shuffle on a silent clock.');
			afterSignInReturn();
		}).catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
	}

	function afterSignInReturn() {
		if (demo) return;
		if (back.status === 'error') { setStatus(back.error.message); return; }
		if (back.status !== 'signed-in') {
			if (!L.list(lib).length && !auth.configured()) setStatus('Signing in is not set up in this copy yet: see ' + q('Bring music in') + ', or try the demo.');
			return;
		}
		listSources().then(function () {
			var stale = L.stale(lib, Date.now(), TS.config.refreshDays);
			if (stale.length) {
				setStatus('Refreshing ' + plural(stale.length, 'track') + ' whose YouTube details are older than ' + TS.config.refreshDays + ' days' + ELL);
				return refreshAll(false);
			}
		});
	}

	// Test hook: read-only views for scripts/qa/drive.mjs. Never used by the page.
	var hook = {};
	['lib', 'store', 'ctl', 'player', 'auth', 'plan', 'bag', 'client', 'presets', 'session'].forEach(function (k) {
		Object.defineProperty(hook, k, { get: function () { return { lib: lib, store: store, ctl: ctl, player: player, auth: auth, plan: plan, bag: bag, client: client, presets: presets, session: session }[k]; } });
	});
	hook.mockErrors = function (map) { if (map && (local || demo)) mockErrors = map; return mockErrors; };
	hook.applyPlan = applyPlan;
	hook.setPlan = function (p) { plan = copyPlan(p); return applyPlan({}); };
	window.__ts = hook;

	start();
})();
