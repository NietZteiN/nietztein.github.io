/*
 * True Shuffle: scrobbling to ListenBrainz, only when the listener asks for
 * it. The listener pastes their own ListenBrainz user token in Settings (the
 * page keeps it with ToyKit, in this browser only); without it nothing is
 * sent, nothing is queued, and nothing is asked of ListenBrainz.
 *
 *     var SC = TrueShuffle.scrobble;
 *     var scrobbler = SC.create({ token: function () { return ToyKit.load('lbToken', ''); }, store: store });
 *     scrobbler.playingNow(track)          when a song starts      -> Promise<{ sent, reason }>
 *     scrobbler.listened(track, info)      when the player leaves it (player.js onListened's info)
 *     scrobbler.flush()                    send what waits          -> Promise<status>
 *     scrobbler.status()                   -> { on, sentToday, waiting, ..., text: '12 listens sent today; 2 waiting' }
 *     SC.validate(token)                   -> Promise<{ ok, user, code, message }>
 *     SC.field(ctx, scrobbler)             Settings' token field (kept only once validate says yes)
 *
 * A song counts as a listen by ListenBrainz's rule: half of it heard, or 4
 * minutes, whichever comes first (`counts`). A listen carries the artist, the
 * title, the album when the library knows one, the length, and
 * additional_info { media_player: 'True Shuffle', submission_client,
 * music_service: 'youtube.com', origin_url: the YouTube watch address,
 * youtube_id, duration_ms }. Its time (listened_at) is when the song started.
 * A song without a sure artist (only the channel's name, a guess) is not sent.
 *
 * Listens that cannot be sent (offline, refused, ListenBrainz down) wait in
 * the store under 'scrobble' (at most 500, the oldest dropped first) and go
 * when the page is back online, at the next listen, or after a wait that
 * doubles from 30 seconds to 30 minutes; 50 go in one request ('import'),
 * one alone as 'single'. A listen ListenBrainz refuses as malformed (400) is
 * dropped, after the batch it was in is sent again one by one; a refused
 * token (401) stops sending until the token changes. "Playing now" is never
 * kept: it is only true for a moment.
 *
 * Requests go without cookies or a referrer, with the token only in the
 * Authorization header, to api.listenbrainz.org only.
 *
 * The source is plain ASCII. UMD: window.TrueShuffle.scrobble in the
 * browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.scrobble = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var API = 'https://api.listenbrainz.org';
	var CLIENT = 'True Shuffle';
	var VERSION = '1.0';
	var KEY = 'scrobble';            // the store key: { queue, day, sentToday, sent, dropped, lastError, retryAt, ... }
	var TOKEN_KEY = 'lbToken';      // where field() keeps the token (ToyKit, this browser only)
	var KEEP = 500;                  // listens kept while they cannot be sent
	var BATCH = 50;                  // listens sent in one request
	var CAP_SEC = 240;               // 4 minutes always count
	var MIN_RETRY = 30000;           // the first wait after a failure; it doubles
	var MAX_RETRY = 30 * 60000;      // up to this
	var NOW_AGAIN_MS = 30000;        // "playing now" for one song is not sent twice within this
	var START_MAX_MS = 6 * 3600000;  // a start older than this is not believed
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function arr(v) { return Array.isArray(v) ? v : []; }
	function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
	// FNV-1a: a token's fingerprint, so a refused token is remembered without keeping it.
	function fingerprint(s) {
		var x = 0x811c9dc5;
		s = str(s);
		for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
		return x.toString(16);
	}
	// The listener's own day, 'YYYY-MM-DD'.
	function localDay(ms) {
		var d = new Date(ms);
		return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
	}
	// A ListenBrainz user token is a UUID (listenbrainz.org/settings).
	function looksLikeToken(s) { return TOKEN.test(str(s).trim()); }

	// ---- The rule and the listen --------------------------------------------------------------

	// Seconds of a song that make it a listen: half of it, 4 minutes at most;
	// 4 minutes when its length is not known.
	function needed(durationSec) { var d = num(durationSec); return d > 0 ? Math.min(d / 2, CAP_SEC) : CAP_SEC; }
	// Does this play count? info: { listenedSec, durationSec, completed } (player.js);
	// the track's own length when the player had none. An unknown length that
	// played to its end counts after 30 seconds.
	function counts(info, track) {
		var i = info || {}, heard = num(i.listenedSec), d = num(i.durationSec) || num(track && track.durationSec);
		if (heard <= 0) return false;
		if (d > 0) return heard >= needed(d);
		return heard >= CAP_SEC || (!!i.completed && heard >= 30);
	}
	// A track as ListenBrainz's track_metadata, or null without a sure artist or a title.
	// o: { durationSec }
	function metadata(track, o) {
		var t = track || {}, artist = str(t.artist).trim(), title = str(t.title).trim();
		if (!artist || !title) return null;
		var id = str(t.videoId || t.id), d = num(o && o.durationSec) || num(t.durationSec);
		var add = { media_player: CLIENT, submission_client: CLIENT, submission_client_version: VERSION, music_service: 'youtube.com' };
		if (YT_ID.test(id)) { add.origin_url = 'https://www.youtube.com/watch?v=' + id; add.youtube_id = id; }
		if (d > 0) add.duration_ms = Math.round(d * 1000);
		var m = { artist_name: artist, track_name: title };
		if (str(t.album).trim()) m.release_name = str(t.album).trim();
		m.additional_info = add;
		return m;
	}
	// One listen: { listened_at (seconds, when the song started), track_metadata }.
	// startedAt: when "playing now" saw it start (ms), else the end less what was heard.
	function listenOf(track, info, startedAt) {
		var i = info || {}, m = metadata(track, i);
		if (!m) return null;
		var at = num(i.at) || Date.now(), start = num(startedAt);
		if (!(start > 0 && start <= at && at - start <= START_MAX_MS)) start = at - num(i.listenedSec) * 1000;
		return { listened_at: Math.floor(start / 1000), track_metadata: m };
	}
	// Why a play is not sent: '' when it is. 'no-track', 'no-artist' (only a guess), 'no-title', 'short'.
	function skipReason(track, info) {
		if (!track) return 'no-track';
		if (!str(track.artist).trim()) return 'no-artist';
		if (!str(track.title).trim()) return 'no-title';
		if (!counts(info, track)) return 'short';
		return '';
	}
	// The body of a submission. type: 'single', 'import' or 'playing_now'.
	function body(type, listens) { return { listen_type: type, payload: arr(listens) }; }

	// ---- Words for Settings ----------------------------------------------------------------------

	// '12 listens sent today; 2 waiting', 'Off: no ListenBrainz token.', with the last problem.
	function statusText(s) {
		s = s || {};
		var w = num(s.waiting);
		if (!s.on) return 'Off: no ListenBrainz token.' + (w ? ' ' + plural(w, 'listen') + ' kept from before.' : '');
		var out = (num(s.sentToday) ? plural(num(s.sentToday), 'listen') : 'No listens') + ' sent today';
		if (w) out += '; ' + w + ' waiting';
		if (s.lastError && s.lastError.text) out += '. ' + s.lastError.text;
		return out;
	}
	var PROBLEM = {
		offline: 'This device is offline; the listens wait.',
		network: 'ListenBrainz could not be reached; trying again later.',
		server: 'ListenBrainz is not answering as it should; trying again later.',
		rate: 'ListenBrainz asked for fewer requests; trying again in a moment.',
		auth: 'ListenBrainz refused the token. Paste it again in Settings.',
		bad: 'ListenBrainz refused a listen as malformed; it was dropped.'
	};

	// ---- The scrobbler ---------------------------------------------------------------------------

	// o: { token() (the listener's token, or '' for off), fetch, now, store
	//      (store.js, or any { get(key, fallback), set(key, value) }, sync or
	//      promised; without one the queue lasts the session), onLine(),
	//      setTimer(fn, ms), clearTimer(t), base (API) }
	function create(o) {
		o = o || {};
		var doFetch = o.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var now = o.now || function () { return Date.now(); };
		var store = o.store || null;
		var onLine = o.onLine || function () { var n = root.navigator; return !n || n.onLine !== false; };
		var setTimer = o.setTimer || function (fn, ms) { var t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; };
		var clearTimer = o.clearTimer || function (t) { clearTimeout(t); };
		var base = str(o.base || API).replace(/\/+$/, '');
		var st = null, loading = null, sending = null, timer = null, starts = {}, lastNow = { id: '', at: 0 };

		function token() { return str(typeof o.token === 'function' ? o.token() : o.token).trim(); }
		function fresh() { return { v: 1, queue: [], day: '', sentToday: 0, sent: 0, dropped: 0, lastError: null, retryAt: 0, tries: 0, lastSentAt: 0, badToken: '', single: 0 }; }
		function roll() { var d = localDay(now()); if (st.day !== d) { st.day = d; st.sentToday = 0; } }
		function load() {
			if (st) return Promise.resolve(st);
			if (!loading) {
				loading = Promise.resolve().then(function () { return store && store.get ? store.get(KEY, null) : null; }).then(null, function () { return null; }).then(function (v) {
					st = fresh();
					if (v && typeof v === 'object') for (var k in st) if (Object.prototype.hasOwnProperty.call(v, k)) st[k] = v[k];
					st.queue = arr(st.queue).slice(-KEEP);
					roll();
					return st;
				});
			}
			return loading;
		}
		function save() {
			if (!store || !store.set) return Promise.resolve();
			return Promise.resolve().then(function () { return store.set(KEY, JSON.parse(JSON.stringify(st))); }).then(function () {}, function () {});
		}
		function problem(code, extra) { st.lastError = { code: code, text: PROBLEM[code] + (extra ? ' (' + extra + ')' : ''), at: now() }; }
		function later(ms) {
			st.tries = (st.tries || 0) + 1;
			st.retryAt = now() + (ms != null ? ms : Math.min(MAX_RETRY, MIN_RETRY * Math.pow(2, st.tries - 1)));
			schedule();
		}
		function schedule() {
			if (timer) { clearTimer(timer); timer = null; }
			if (!st || !st.queue.length || !st.retryAt) return;
			timer = setTimer(function () { timer = null; api.flush(); }, Math.max(0, st.retryAt - now()));
		}

		// One POST to submit-listens. -> Promise<{ status, json, res }>; rejects when nothing came back.
		function post(type, listens, t) {
			if (!doFetch) return Promise.reject(new Error('no fetch'));
			return Promise.resolve().then(function () {
				return doFetch(base + '/1/submit-listens', {
					method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
					headers: { Authorization: 'Token ' + t, 'Content-Type': 'application/json' },
					body: JSON.stringify(body(type, listens))
				});
			}).then(function (res) {
				return Promise.resolve(res && res.text ? res.text() : '').then(function (text) {
					var j = null;
					try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
					return { status: +(res && res.status) || 0, json: j, res: res };
				});
			});
		}
		function header(res, name) { return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null; }

		// Send what waits, a batch at a time, until it is all sent or something stops it.
		function step() {
			roll();
			var t = token();
			if (!t || !st.queue.length) return Promise.resolve();
			if (st.badToken && st.badToken === fingerprint(t)) return Promise.resolve();
			if (!onLine()) { problem('offline'); return save(); }
			if (st.retryAt > now()) { schedule(); return save(); }
			var batch = st.queue.slice(0, st.single > 0 ? 1 : BATCH);
			return post(batch.length === 1 ? 'single' : 'import', batch, t).then(function (r) {
				if (r.status >= 200 && r.status < 300) {
					st.queue.splice(0, batch.length);
					st.sentToday += batch.length;
					st.sent += batch.length;
					st.lastSentAt = now();
					st.lastError = null;
					st.retryAt = 0;
					st.tries = 0;
					if (st.single > 0) st.single--;
					// the allowance is spent: wait for it to come back before the next batch
					if (header(r.res, 'X-RateLimit-Remaining') === '0' && st.queue.length) { st.retryAt = now() + Math.max(1, num(header(r.res, 'X-RateLimit-Reset-In'))) * 1000; schedule(); return save(); }
					return save().then(step);
				}
				if (r.status === 401 || r.status === 403) { st.badToken = fingerprint(t); problem('auth'); return save(); }
				if (r.status === 400 || r.status === 413) {
					// one of the batch is malformed: send them one by one to find it
					if (batch.length > 1) { st.single = batch.length; return step(); }
					st.queue.shift();
					st.dropped++;
					if (st.single > 0) st.single--;
					problem('bad', r.json && r.json.error ? str(r.json.error).slice(0, 120) : '');
					return save().then(step);
				}
				if (r.status === 429) { problem('rate'); later(Math.max(1, num(header(r.res, 'X-RateLimit-Reset-In')) || 10) * 1000); return save(); }
				problem('server', 'HTTP ' + r.status);
				later();
				return save();
			}, function (e) {
				problem(onLine() ? 'network' : 'offline', e && e.message ? str(e.message).slice(0, 80) : '');
				if (onLine()) later();
				return save();
			});
		}

		var api = {
			// "Playing now", when a song starts: never kept. The same play again
			// (playing after a pause: the song was not left yet) and the same song
			// within 30 s are not sent again, so the page may call it on every
			// "playing" the player reports.
			playingNow: function (track) {
				var t = token(), id = str(track && (track.videoId || track.id));
				if (!t) return Promise.resolve({ sent: false, reason: 'off' });
				if (id && Object.prototype.hasOwnProperty.call(starts, id)) return Promise.resolve({ sent: false, reason: 'twice' });
				if (id) {
					// when it started, for its listened_at
					starts[id] = now();
					var ks = Object.keys(starts);
					if (ks.length > 50) delete starts[ks[0]];
				}
				var why = !track ? 'no-track' : !str(track.artist).trim() ? 'no-artist' : !str(track.title).trim() ? 'no-title' : '';
				if (why) return Promise.resolve({ sent: false, reason: why });
				if (id && lastNow.id === id && now() - lastNow.at < NOW_AGAIN_MS) return Promise.resolve({ sent: false, reason: 'twice' });
				return load().then(function () {
					if (st.badToken && st.badToken === fingerprint(t)) return { sent: false, reason: 'auth' };
					if (!onLine()) return { sent: false, reason: 'offline' };
					lastNow = { id: id, at: now() };
					return post('playing_now', [{ track_metadata: metadata(track) }], t).then(function (r) {
						if (r.status === 401 || r.status === 403) { st.badToken = fingerprint(t); problem('auth'); return save().then(function () { return { sent: false, reason: 'auth' }; }); }
						return { sent: r.status >= 200 && r.status < 300, reason: r.status >= 200 && r.status < 300 ? '' : 'http-' + r.status };
					}, function () { return { sent: false, reason: 'network' }; });
				});
			},
			// A song was left (player.js onListened). Kept and sent when it counts.
			// -> Promise<{ queued, sent, reason, waiting }>
			listened: function (track, info) {
				var t = token(), id = str(track && (track.videoId || track.id)), started = starts[id];
				delete starts[id];
				if (!t) return Promise.resolve({ queued: false, sent: false, reason: 'off', waiting: st ? st.queue.length : 0 });
				return load().then(function () {
					var why = skipReason(track, info);
					if (why) return { queued: false, sent: false, reason: why, waiting: st.queue.length };
					var l = listenOf(track, Object.assign({ at: now() }, info), started);
					var twice = st.queue.some(function (x) { return x.listened_at === l.listened_at && x.track_metadata.track_name === l.track_metadata.track_name && x.track_metadata.artist_name === l.track_metadata.artist_name; });
					if (twice) return { queued: false, sent: false, reason: 'twice', waiting: st.queue.length };
					st.queue.push(l);
					while (st.queue.length > KEEP) { st.queue.shift(); st.dropped++; }
					return save().then(api.flush).then(function () {
						// a send already under way may have finished just before this listen joined
						if (st.queue.indexOf(l) >= 0 && !st.retryAt && !st.lastError) return api.flush();
					}).then(function () {
						var still = st.queue.indexOf(l) >= 0;
						return { queued: true, sent: !still, reason: '', waiting: st.queue.length };
					});
				});
			},
			// Send what waits now (when online, with a token, and not told to wait). -> Promise<status>
			flush: function () {
				if (sending) return sending;
				sending = load().then(step).then(function () { sending = null; return api.status(); }, function (e) { sending = null; throw e; });
				return sending;
			},
			// -> { on, sentToday, sent, waiting, dropped, lastError, retryAt, lastSentAt, text }
			status: function () {
				var s = st || fresh();
				if (st) roll();
				var out = { on: !!token(), sentToday: s.sentToday, sent: s.sent, waiting: s.queue.length, dropped: s.dropped, lastError: s.lastError ? { code: s.lastError.code, text: s.lastError.text, at: s.lastError.at } : null, retryAt: s.retryAt, lastSentAt: s.lastSentAt };
				out.text = statusText(out);
				return out;
			},
			// The listens waiting, oldest first (copies).
			pending: function () { return load().then(function () { return JSON.parse(JSON.stringify(st.queue)); }); },
			// Forget what waits and the last problem (the token was taken away). The counts stay.
			clear: function () {
				return load().then(function () {
					st.queue = [];
					st.lastError = null;
					st.retryAt = 0;
					st.tries = 0;
					st.single = 0;
					st.badToken = '';
					schedule();
					return save();
				});
			},
			// A new token: forget that an old one was refused, and send what waits.
			tokenChanged: function () { return load().then(function () { st.badToken = ''; st.retryAt = 0; st.tries = 0; return api.flush(); }); },
			destroy: function () { if (timer) clearTimer(timer); timer = null; if (onOnline && root.removeEventListener) root.removeEventListener('online', onOnline); }
		};
		var onOnline = null;
		if (root.addEventListener && o.watchOnline !== false) {
			onOnline = function () { if (st) { st.retryAt = 0; } api.flush(); };
			root.addEventListener('online', onOnline);
		}
		return api;
	}

	// ---- Checking a token ------------------------------------------------------------------------

	// GET /1/validate-token with the token in the Authorization header.
	// -> Promise<{ ok, user (the ListenBrainz user name), code: '' | 'empty' |
	//    'auth' | 'rate' | 'server' | 'network', message }>; it never rejects.
	// o: { fetch, base }
	function validate(token, o) {
		o = o || {};
		var doFetch = o.fetch || (root.fetch ? root.fetch.bind(root) : null), t = str(token).trim();
		var base = str(o.base || API).replace(/\/+$/, '');
		function no(code, message) { return { ok: false, user: '', code: code, message: message }; }
		if (!t) return Promise.resolve(no('empty', 'Paste your ListenBrainz user token first (listenbrainz.org/settings).'));
		if (!doFetch) return Promise.resolve(no('network', 'This browser cannot ask ListenBrainz.'));
		return Promise.resolve().then(function () {
			return doFetch(base + '/1/validate-token', { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Token ' + t } });
		}).then(function (res) {
			return Promise.resolve(res && res.text ? res.text() : '').then(function (text) {
				var j = null, status = +(res && res.status) || 0;
				try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
				if (status === 200 && j && j.valid === true) return { ok: true, user: str(j.user_name), code: '', message: '' };
				if ((status === 200 && j && j.valid === false) || status === 400 || status === 401 || status === 403) return no('auth', 'ListenBrainz does not know this token. Copy it again from listenbrainz.org/settings.');
				if (status === 429) return no('rate', 'ListenBrainz asked for fewer requests. Try again in a minute.');
				return no('server', 'ListenBrainz answered ' + status + ' instead of checking the token. Try again later.');
			});
		}, function () { return no('network', 'ListenBrainz could not be reached from this page.'); });
	}

	// ---- Settings' field ---------------------------------------------------------------------------

	// The token field for Settings, as one node: the token is kept (ToyKit,
	// this browser only, under TOKEN_KEY) only once validate() says
	// ListenBrainz knows it, which also proves this browser may talk to
	// ListenBrainz; an empty field turns scrobbling off and forgets what
	// waits. Below it, the scrobbler's status in words.
	// ctx: the page's ctx (h, say). o: { load(key), store(key, value) (ToyKit's
	// by default), fetch, base }
	function field(ctx, scrobbler, o) {
		o = o || {};
		var h = ctx.h, kit = root.ToyKit || {};
		var load = o.load || function (k) { return kit.load ? kit.load(k, '') : ''; };
		var keep = o.store || function (k, v) { if (kit.store) kit.store(k, v); };
		var say = ctx.say || function () {};
		var wrap = h('div', { class: 'ts-scrobble' });
		var form = h('form', { class: 'ts-inline-form' });
		var input = h('input', { class: 'kit-input', id: 'lb-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: '01234567-89ab-cdef-0123-456789abcdef', aria: { label: 'ListenBrainz user token for this browser only' } });
		input.value = str(load(TOKEN_KEY) || '');
		form.appendChild(h('label', { class: 'ts-muted', for: 'lb-token', text: 'ListenBrainz user token (optional, this browser only): what you listen to goes to your ListenBrainz' }));
		form.appendChild(input);
		form.appendChild(h('button', { class: 'ts-btn ts-btn--secondary ts-btn--sm', type: 'submit', text: 'Use' }));
		var note = h('p', { class: 'ts-muted', role: 'status' });
		function show() { note.textContent = scrobbler ? scrobbler.status().text : ''; }
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			var v = input.value.trim();
			if (!v) {
				keep(TOKEN_KEY, null);
				say('Scrobbling is off: nothing goes to ListenBrainz.');
				(scrobbler ? scrobbler.clear() : Promise.resolve()).then(show, show);
				return;
			}
			if (!looksLikeToken(v)) { say('A ListenBrainz user token looks like 01234567-89ab-cdef-0123-456789abcdef (listenbrainz.org/settings).'); return; }
			note.textContent = 'Checking the token with ListenBrainz' + String.fromCharCode(0x2026);
			validate(v, { fetch: o.fetch, base: o.base }).then(function (r) {
				if (!r.ok) { say(r.message); show(); return; }
				keep(TOKEN_KEY, v);
				say('Scrobbling to ListenBrainz as ' + r.user + ', from this browser.');
				(scrobbler ? scrobbler.tokenChanged() : Promise.resolve()).then(show, show);
			});
		});
		wrap.appendChild(form);
		wrap.appendChild(note);
		show();
		return wrap;
	}

	return {
		create: create, validate: validate, field: field, counts: counts, needed: needed, metadata: metadata, listenOf: listenOf,
		skipReason: skipReason, body: body, statusText: statusText, looksLikeToken: looksLikeToken, localDay: localDay,
		API: API, CLIENT: CLIENT, VERSION: VERSION, KEY: KEY, TOKEN_KEY: TOKEN_KEY, KEEP: KEEP, BATCH: BATCH
	};
});
