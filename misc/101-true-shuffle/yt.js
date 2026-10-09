/*
 * True Shuffle: Google sign-in, the YouTube Data API, the import, and the
 * optional MusicBrainz lookup.
 *
 * Nothing in this file contacts any host until one of its functions is
 * called with that purpose: creating an auth or a client object sends
 * nothing.
 *
 *   endpoints({ search, hostname, storage })   where to talk to (Google, or the
 *                                              local fake when the page is on localhost)
 *   createAuth({ clientId, ... })              sign in, the token, disconnect
 *   createClient({ getToken, ... })            the Data API: paging, batching,
 *                                              retries, quota count, typed errors
 *   importInto({ client, lib, store, playlist })   a playlist into the library, resumable
 *   refreshInto({ client, lib, store })        metadata again; marks what disappeared
 *   createMusicBrainz()                        finer genres per artist, one request a second
 *
 * Sign-in is OAuth 2.0 for a browser app with the read-only YouTube scope.
 * Adding a song to one of the account's playlists needs WRITE_SCOPE, which
 * is asked for only then (signIn({ scope: WRITE_SCOPE })); auth.canWrite()
 * says whether the token has it.
 * The default is the plain redirect: the page sends the browser to
 * accounts.google.com with response_type=token and a random state, Google
 * sends it back to the page's own address with the token in the fragment,
 * and the state is checked. No third-party script runs here for that. The
 * token lasts an hour, lives in memory and in sessionStorage (so a reload
 * keeps the session and closing the tab ends it), is sent only to the API in
 * an Authorization header, and is revoked on disconnect.
 *
 * Errors are YTError objects with a `code` the page can switch on:
 *   'signed-out'   no token, or Google no longer accepts it: sign in again
 *   'forbidden'    Google refused (`reason` says which rule)
 *   'quota'        the project's daily quota is used up (resets at midnight Pacific)
 *   'rate'         too many requests even after waiting
 *   'not-found'    no such playlist (or video)
 *   'needs-write'  a write was refused because the sign-in may only read
 *   'bad-request'  a request Google called invalid (an expired page token, say)
 *   'server'       Google kept answering 5xx
 *   'network'      no answer at all
 *   'aborted'      the caller's AbortSignal fired
 *   'config', 'denied', 'state', 'scope'   sign-in problems
 * and a `message` that is a sentence a reader can be shown.
 *
 * UMD: window.TrueShuffle.yt in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, node ? require('./parse.js') : (root.TrueShuffle || {}).parse, node ? require('./library.js') : (root.TrueShuffle || {}).library);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.yt = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, Parse, Library) {
	'use strict';

	var SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
	// Adding to a playlist: Google has no narrower scope for playlistItems.insert.
	var WRITE_SCOPE = 'https://www.googleapis.com/auth/youtube';
	var WRITE_SCOPES = [WRITE_SCOPE, 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtubepartner'];
	// Does a granted-scope string allow writes?
	function canWriteScope(s) { return String(s || '').split(/\s+/).some(function (x) { return WRITE_SCOPES.indexOf(x) >= 0; }); }
	var GOOGLE = {
		auth: 'https://accounts.google.com/o/oauth2/v2/auth',
		revoke: 'https://oauth2.googleapis.com/revoke',
		api: 'https://www.googleapis.com/youtube/v3',
		mb: 'https://musicbrainz.org/ws/2',
		gis: 'https://accounts.google.com/gsi/client',
		test: false
	};
	var KEY_TOKEN = 'toy.101-true-shuffle.token';
	var KEY_STATE = 'toy.101-true-shuffle.oauth';
	var KEY_API = 'toy.101-true-shuffle.api';
	var DAY = 86400000;
	var TERMS = {
		youtubeTerms: 'https://www.youtube.com/t/terms',
		googlePrivacy: 'https://policies.google.com/privacy',
		googlePermissions: 'https://myaccount.google.com/permissions'
	};

	// ---- Errors -----------------------------------------------------------------------

	function YTError(code, message, extra) {
		var e = new Error(message);
		e.name = 'YTError';
		e.code = code;
		if (extra) for (var k in extra) e[k] = extra[k];
		return e;
	}
	function isYTError(e) { return !!e && e.name === 'YTError'; }

	// ---- Where to talk to ----------------------------------------------------------------

	function isLoopback(hostname) {
		hostname = String(hostname || '').toLowerCase();
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
	}

	// The real endpoints, unless the page is on localhost and its address says
	// ?api=http://127.0.0.1:<port>: then everything goes to that local fake
	// (test/fake-youtube.mjs). The override is ignored anywhere else, and may
	// only point at localhost. It is remembered in sessionStorage so that it
	// survives the sign-in redirect, which returns to the bare address.
	//   opts: { search, hostname, storage }  (default: the page's own)
	function endpoints(opts) {
		opts = opts || {};
		var loc = root.location || {};
		var search = opts.search != null ? opts.search : (loc.search || '');
		var hostname = opts.hostname != null ? opts.hostname : (loc.hostname || '');
		var storage = opts.storage !== undefined ? opts.storage : safeSession();
		if (!isLoopback(hostname)) return copy(GOOGLE);
		var api = null;
		try { api = new URLSearchParams(search).get('api'); } catch (e) { api = null; }
		if (api === 'off') { if (storage) try { storage.removeItem(KEY_API); } catch (e2) { /* no storage */ } return copy(GOOGLE); }
		if (!api && storage) { try { api = storage.getItem(KEY_API); } catch (e3) { api = null; } }
		if (!api) return copy(GOOGLE);
		var u;
		try { u = new URL(api); } catch (e4) { return copy(GOOGLE); }
		if (u.protocol !== 'http:' || !isLoopback(u.hostname)) return copy(GOOGLE);
		var base = u.origin;
		if (storage) try { storage.setItem(KEY_API, base); } catch (e5) { /* no storage */ }
		return { auth: base + '/o/oauth2/v2/auth', revoke: base + '/revoke', api: base + '/youtube/v3', mb: base + '/ws/2', gis: null, test: true, base: base };
	}
	function copy(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }
	function safeSession() { try { return root.sessionStorage || null; } catch (e) { return null; } }

	// ---- Sign-in: the pure parts -------------------------------------------------------------

	// The address Google must send the browser back to: this page, without
	// "index.html", query or fragment. It has to equal, character for
	// character, the redirect URI registered for the client id.
	function redirectUriFor(loc) {
		loc = loc || root.location;
		return String(loc.origin) + String(loc.pathname).replace(/index\.html$/, '');
	}

	function randomState(cryptoObj) {
		var c = cryptoObj || root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
		if (!c || !c.getRandomValues) throw YTError('config', 'This browser has no secure random numbers, so sign-in cannot be done safely.');
		var bytes = new Uint8Array(16), out = '';
		c.getRandomValues(bytes);
		for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
		return out;
	}

	// p: { authUrl, clientId, redirectUri, scope, state, prompt, loginHint }
	function buildAuthUrl(p) {
		var q = new URLSearchParams();
		q.set('client_id', p.clientId);
		q.set('redirect_uri', p.redirectUri);
		q.set('response_type', 'token');
		q.set('scope', p.scope || SCOPE);
		q.set('state', p.state);
		q.set('include_granted_scopes', 'true');
		if (p.prompt) q.set('prompt', p.prompt);
		if (p.loginHint) q.set('login_hint', p.loginHint);
		return (p.authUrl || GOOGLE.auth) + '?' + q.toString();
	}

	// '#access_token=...&state=...' -> an object of its fields, or null when the
	// fragment is not an answer from the sign-in.
	function parseAuthResponse(hash) {
		var h = String(hash || '').replace(/^#/, '');
		if (!h || !/(^|&)(access_token|error)=/.test(h)) return null;
		var q = new URLSearchParams(h), out = {};
		q.forEach(function (v, k) { out[k] = v; });
		return out;
	}

	// Is the answer the one this page asked for? -> { ok: true, token: {
	// accessToken, expiresAt, scope } } or { ok: false, error: YTError }
	function checkAuthResponse(resp, expectedState, now, scope) {
		if (!resp) return { ok: false, error: YTError('state', 'There is no sign-in answer here.') };
		if (!expectedState || resp.state !== expectedState) {
			return { ok: false, error: YTError('state', 'The sign-in answer does not belong to a sign-in this page started, so it was ignored. Please sign in again.') };
		}
		if (resp.error) {
			if (resp.error === 'access_denied') return { ok: false, error: YTError('denied', 'Access was not granted, so nothing was read.', { reason: resp.error }) };
			return { ok: false, error: YTError('denied', 'Google did not complete the sign-in (' + resp.error + ').', { reason: resp.error }) };
		}
		if (!resp.access_token) return { ok: false, error: YTError('state', 'The sign-in answer has no token.') };
		var want = scope || SCOPE, granted = String(resp.scope || '').split(/\s+/).filter(Boolean);
		// Every scope asked for must be granted (want may list several, space-separated).
		if (resp.scope != null && want.split(' ').filter(Boolean).some(function (w) { return granted.indexOf(w) < 0; })) {
			return { ok: false, error: YTError('scope', canWriteScope(want) ? 'The sign-in did not allow editing your YouTube playlists.' : 'The sign-in did not grant read access to YouTube, so nothing can be read.') };
		}
		var seconds = Math.max(0, Math.min(86400, parseInt(resp.expires_in, 10) || 3600));
		return { ok: true, token: { accessToken: resp.access_token, expiresAt: now + seconds * 1000, scope: granted.join(' ') || want } };
	}

	// ---- Sign-in: the object ----------------------------------------------------------------

	// opts: { clientId, scope, redirectUri, mode ('redirect' | 'gis'),
	//         endpoints (from endpoints()), storage, location, history, fetch, now }
	// The last five default to the browser's own and exist for the tests.
	function createAuth(opts) {
		opts = opts || {};
		var ep = opts.endpoints || endpoints();
		var storage = opts.storage !== undefined ? opts.storage : safeSession();
		var loc = opts.location || root.location;
		var hist = opts.history || root.history;
		var now = opts.now || function () { return Date.now(); };
		var doFetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var clientId = String(opts.clientId || '').trim();
		var scope = opts.scope || SCOPE;
		var mode = opts.mode === 'gis' ? 'gis' : 'redirect';
		var token = null, subs = [];

		function read(key) { try { var v = storage && storage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
		function write(key, value) { try { if (storage) { if (value == null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(value)); } } catch (e) { /* storage refused: the token stays in memory only */ } }
		function changed() { subs.slice().forEach(function (fn) { fn(api.signedIn()); }); }
		function setToken(t) { token = t; write(KEY_TOKEN, t); changed(); }

		// A reload: take the token back from sessionStorage if it is still good.
		var saved = read(KEY_TOKEN);
		if (saved && saved.accessToken && saved.expiresAt > now() + 60000) token = saved; else if (saved) write(KEY_TOKEN, null);

		var api = {
			mode: mode,
			test: !!ep.test,
			configured: function () { return !!clientId; },
			clientId: function () { return clientId; },
			setClientId: function (id) { clientId = String(id || '').trim(); },
			redirectUri: function () { return opts.redirectUri || redirectUriFor(loc); },

			// The current access token, or null. A token within a minute of its
			// end counts as gone.
			token: function () {
				if (token && token.expiresAt <= now() + 60000) { token = null; write(KEY_TOKEN, null); changed(); }
				return token ? token.accessToken : null;
			},
			signedIn: function () { return !!api.token(); },
			// May this token add to playlists? (Signed in with WRITE_SCOPE.)
			canWrite: function () { return !!api.token() && canWriteScope(token.scope); },
			secondsLeft: function () { return api.token() ? Math.max(0, Math.round((token.expiresAt - now()) / 1000)) : 0; },
			onChange: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },

			// Where signIn() would send the browser. -> { url, state }
			signInUrl: function (o) {
				o = o || {};
				if (!clientId) throw YTError('config', 'No Google client id is set, so there is nothing to sign in to.');
				var state = randomState(opts.crypto);
				return { url: buildAuthUrl({ authUrl: ep.auth, clientId: clientId, redirectUri: api.redirectUri(), scope: o.scope || scope, state: state, prompt: o.prompt, loginHint: o.loginHint }), state: state };
			},

			// Start signing in. Redirect mode: remembers the state and the page's
			// query, then leaves for Google; the returned promise never settles
			// because the page is gone. GIS mode: opens Google's popup and resolves
			// when the token is here. Call it from a click.
			signIn: function (o) {
				var s;
				if (mode === 'gis') return gisSignIn(o);
				try { s = api.signInUrl(o); } catch (e) { return Promise.reject(e); }
				write(KEY_STATE, { state: s.state, at: now(), search: String(loc.search || ''), scope: (o && o.scope) || scope });
				loc.assign(s.url);
				return new Promise(function () {});
			},

			// Call once when the page loads. If the address carries a sign-in
			// answer it is checked against the remembered state, the token is
			// kept, and the fragment is removed from the address (and the query
			// the page had before signing in is put back).
			// -> { status: 'none' | 'signed-in' | 'error', error }
			handleRedirect: function () {
				var resp = parseAuthResponse(loc.hash);
				if (!resp) return { status: 'none' };
				var pending = read(KEY_STATE);
				write(KEY_STATE, null);
				try {
					if (hist && hist.replaceState) hist.replaceState(null, '', String(loc.pathname) + (pending && pending.search ? pending.search : String(loc.search || '')));
				} catch (e) { /* the address keeps its fragment; the token is still handled */ }
				// An answer is accepted for ten minutes after the question.
				var fresh = pending && pending.state && now() - pending.at < 600000;
				var asked = (pending && pending.scope) || scope;
				var res = checkAuthResponse(resp, fresh ? pending.state : null, now(), asked), writeDenied = false;
				// Asked to write, allowed only to read: keep the reading sign-in.
				if (!res.ok && res.error.code === 'scope' && asked !== scope) {
					var readOnly = checkAuthResponse(resp, fresh ? pending.state : null, now(), scope);
					if (readOnly.ok) { res = readOnly; writeDenied = true; }
				}
				if (!res.ok) return { status: 'error', error: res.error };
				res.token.clientId = clientId;
				setToken(res.token);
				return writeDenied ? { status: 'signed-in', writeDenied: true, asked: asked } : { status: 'signed-in', asked: asked };
			},

			// Forget the token here without telling Google.
			forget: function () { if (token || read(KEY_TOKEN)) setToken(null); },

			// Disconnect: ask Google to revoke the token, then forget it. The
			// token is forgotten whatever Google answers.
			// -> { revoked: true | false | 'sent' }  ('sent': the request went out
			// but the browser did not let the page read the answer)
			signOut: function () {
				var t = api.token();
				api.forget();
				if (!t) return Promise.resolve({ revoked: false });
				return revoke(t);
			}
		};

		function revoke(t) {
			if (!doFetch) return Promise.resolve({ revoked: false });
			var init = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t) };
			return doFetch(ep.revoke, init).then(function (res) {
				var ok = res.ok || res.status === 400;      // 400: the token was already invalid
				return (res.text ? res.text() : Promise.resolve('')).then(function () { return { revoked: ok }; }, function () { return { revoked: ok }; });
			}, function () {
				// Google documents this endpoint as closed to cross-origin reads. A
				// request the page may send but not read still revokes the token.
				init.mode = 'no-cors';
				return doFetch(ep.revoke, init).then(function () { return { revoked: 'sent' }; }, function () { return { revoked: false }; });
			});
		}

		// Google Identity Services, for the case that Google refuses the plain
		// redirect for a client. It loads Google's script and opens a popup.
		// NOT TESTED: it cannot be run without a real Google client.
		function gisSignIn(o) {
			if (!clientId) return Promise.reject(YTError('config', 'No Google client id is set, so there is nothing to sign in to.'));
			if (!ep.gis) return Promise.reject(YTError('config', 'The popup sign-in is not available against the local test server.'));
			return loadScript(ep.gis).then(function () {
				return new Promise(function (resolve, reject) {
					var g = root.google && root.google.accounts && root.google.accounts.oauth2;
					if (!g) { reject(YTError('network', 'Google\'s sign-in script did not load.')); return; }
					var tc = g.initTokenClient({
						client_id: clientId,
						scope: (o && o.scope) || scope,
						prompt: o && o.prompt ? o.prompt : '',
						callback: function (resp) {
							if (!resp || resp.error || !resp.access_token) { reject(YTError('denied', 'Access was not granted, so nothing was read.', { reason: resp && resp.error })); return; }
							var seconds = Math.max(0, Math.min(86400, parseInt(resp.expires_in, 10) || 3600));
							setToken({ accessToken: resp.access_token, expiresAt: now() + seconds * 1000, scope: String(resp.scope || scope), clientId: clientId });
							resolve({ status: 'signed-in' });
						},
						error_callback: function (err) { reject(YTError('denied', 'The sign-in window was closed or blocked.', { reason: err && err.type })); }
					});
					tc.requestAccessToken();
				});
			});
		}

		return api;
	}

	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var doc = root.document;
			if (!doc) { reject(YTError('config', 'No document to load a script into.')); return; }
			var s = doc.createElement('script');
			s.src = src;
			s.async = true;
			s.onload = function () { resolve(); };
			s.onerror = function () { reject(YTError('network', 'A script could not be loaded from ' + src.replace(/^https?:\/\/([^/]+).*$/, '$1') + '.')); };
			doc.head.appendChild(s);
		});
	}

	// ---- The Data API client -------------------------------------------------------------------

	// The day the quota counts for: Google resets it at midnight Pacific time.
	function pacificDay(ms) {
		try {
			var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
			var o = {};
			parts.forEach(function (p) { o[p.type] = p.value; });
			return o.year + '-' + o.month + '-' + o.day;
		} catch (e) {
			return new Date(ms - 8 * 3600000).toISOString().slice(0, 10);
		}
	}
	// Add units to a stored tally { day, units }, starting again on a new
	// Pacific day. -> the new tally (store it under the key 'quota').
	var SEARCH_UNITS = 100;
	var UNITS = { 'search.list': SEARCH_UNITS, 'playlistItems.insert': 50, 'playlistItems.delete': 50 };
	function tallyQuota(saved, units, now) {
		var day = pacificDay(now == null ? Date.now() : now);
		var base = saved && saved.day === day ? +saved.units || 0 : 0;
		return { day: day, units: base + (+units || 0) };
	}

	function describe(status, reason, googleMessage, write) {
		if (status === 401) return ['signed-out', 'The sign-in has ended. Sign in again to go on.'];
		if (status === 403) {
			if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return ['quota', 'Today\'s YouTube API quota for this Google project is used up. It starts again at midnight Pacific time; what was imported so far is kept.'];
			if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return ['rate', 'YouTube asked for fewer requests. Try again in a minute.'];
			if (reason === 'accessNotConfigured') return ['forbidden', 'The YouTube Data API is not switched on for this Google project (step 2 of the setup).'];
			if (reason === 'insufficientPermissions') return write ? ['needs-write', 'True Shuffle may only read your YouTube account. Allow it to edit your playlists to add songs.'] : ['forbidden', 'The sign-in did not grant read access to YouTube. Disconnect and sign in again.'];
			if (reason === 'playlistContainsMaximumNumberOfVideos') return ['forbidden', 'That playlist is full: YouTube allows 5,000 videos in one.'];
			if (reason === 'youtubeSignupRequired') return ['forbidden', 'This Google account has no YouTube channel, so it has no playlists to read.'];
			if (reason === 'playlistItemsNotAccessible' || reason === 'playlistForbidden') return ['forbidden', 'This account may not read that playlist.'];
			return ['forbidden', 'YouTube refused the request' + (googleMessage ? ': ' + googleMessage : '.')];
		}
		if (status === 404) return ['not-found', reason === 'videoNotFound' ? 'YouTube does not know that video (it may have been deleted).' : reason === 'playlistItemNotFound' ? 'That song is no longer in the playlist.' : 'YouTube does not know that playlist (it may have been deleted).'];
		if (status === 429) return ['rate', 'YouTube asked for fewer requests. Try again in a minute.'];
		if (status === 400) return ['bad-request', 'YouTube did not accept the request' + (googleMessage ? ': ' + googleMessage : '.')];
		if (status >= 500) return ['server', 'YouTube is having trouble answering. Try again later; what was imported so far is kept.'];
		return ['forbidden', 'YouTube answered ' + status + '.'];
	}

	// opts: { getToken() -> string | null, endpoints, fetch, sleep(ms), now,
	//         maxRetries (4), onQuota(units, method), onSignedOut() }
	function createClient(opts) {
		opts = opts || {};
		var ep = opts.endpoints || endpoints();
		var doFetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
		var now = opts.now || function () { return Date.now(); };
		var maxRetries = opts.maxRetries == null ? 4 : opts.maxRetries;
		var tally = { units: 0, requests: 0, byMethod: {}, since: now() };

		// Every list call costs one unit, an error included; a search costs 100,
		// adding to or removing from a playlist 50.
		function spend(method) {
			var units = UNITS[method] || 1;
			tally.units += units;
			tally.requests += 1;
			tally.byMethod[method] = (tally.byMethod[method] || 0) + 1;
			if (opts.onQuota) { try { opts.onQuota(units, method); } catch (e) { /* the meter must not break the import */ } }
		}

		// One GET, with retries. resource: 'playlists', params: an object.
		function get(resource, params, o) { return call('GET', resource, params, null, o); }
		// One request. Writes (POST, DELETE) are not retried: a retry could add a song twice.
		function call(verb, resource, params, body, o) {
			o = o || {};
			var write = verb !== 'GET', method = resource + '.' + (verb === 'POST' ? 'insert' : verb === 'DELETE' ? 'delete' : 'list'), attempt = 0;
			var q = new URLSearchParams();
			Object.keys(params).forEach(function (k) { if (params[k] != null && params[k] !== '') q.set(k, params[k]); });
			var url = ep.api + '/' + resource + '?' + q.toString();

			function again(err) {
				if (write || attempt >= maxRetries) return Promise.reject(err);
				var wait = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
				attempt++;
				return sleep(wait).then(run);
			}
			function run() {
				if (o.signal && o.signal.aborted) return Promise.reject(YTError('aborted', 'Stopped.'));
				var token = opts.getToken ? opts.getToken() : null;
				if (!token) return Promise.reject(YTError('signed-out', 'Sign in to read from YouTube.'));
				var init = { method: verb, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: o.signal };
				if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
				return doFetch(url, init).then(function (res) {
					spend(method);
					if (res.status === 204) return {};
					if (res.ok) return res.json();
					return res.text().then(function (text) {
						var body = null, reason = '', message = '';
						try { body = JSON.parse(text); } catch (e) { body = null; }
						if (body && body.error) {
							message = String(body.error.message || '');
							reason = body.error.errors && body.error.errors[0] ? String(body.error.errors[0].reason || '') : '';
						}
						var d = describe(res.status, reason, message, write);
						var err = YTError(d[0], d[1], { status: res.status, reason: reason, detail: message, method: method });
						if (d[0] === 'signed-out' && opts.onSignedOut) { try { opts.onSignedOut(); } catch (e2) { /* ignore */ } }
						if (d[0] === 'server' || d[0] === 'rate') return again(err);
						throw err;
					});
				}, function (e) {
					if (e && e.name === 'AbortError') throw YTError('aborted', 'Stopped.');
					if (o.signal && o.signal.aborted) throw YTError('aborted', 'Stopped.');
					return again(YTError('network', 'YouTube could not be reached. Check the connection; what was imported so far is kept.', { detail: e && e.message, method: method }));
				});
			}
			return run();
		}

		// Every page of a list call. -> all items
		function all(resource, params, o) {
			var items = [];
			function page(token) {
				var p = copy(params);
				p.maxResults = 50;
				if (token) p.pageToken = token;
				return get(resource, p, o).then(function (res) {
					items = items.concat(res.items || []);
					return res.nextPageToken ? page(res.nextPageToken) : items;
				});
			}
			return page(null);
		}

		var client = {
			endpoints: ep,
			get: get,
			// What this client has spent since it was made: { units, requests, byMethod, since }
			quota: function () { return { units: tally.units, requests: tally.requests, byMethod: copy(tally.byMethod), since: tally.since }; },

			// The signed-in account's channel: { channelId, title, likes, uploads },
			// or null when the Google account has no YouTube channel. 1 unit.
			me: function (o) {
				return get('channels', { part: 'snippet,contentDetails', mine: 'true', maxResults: 5 }, o).then(function (res) {
					var c = res.items && res.items[0];
					if (!c) return null;
					var rel = (c.contentDetails && c.contentDetails.relatedPlaylists) || {};
					return { channelId: c.id, title: (c.snippet && c.snippet.title) || '', likes: rel.likes || null, uploads: rel.uploads || null };
				});
			},

			// The account's own playlists, private ones included.
			// -> [{ id, title, count, privacy, publishedAt }]. 1 unit per 50.
			playlists: function (o) {
				return all('playlists', { part: 'snippet,contentDetails,status', mine: 'true' }, o).then(function (items) {
					return items.map(function (p) {
						return {
							id: p.id,
							title: (p.snippet && p.snippet.title) || '',
							count: p.contentDetails && p.contentDetails.itemCount != null ? p.contentDetails.itemCount : null,
							privacy: (p.status && p.status.privacyStatus) || '',
							publishedAt: (p.snippet && p.snippet.publishedAt) || null
						};
					});
				});
			},

			// What can be imported: the Liked videos first, then the playlists.
			// -> { me, sources: [{ id, title, count, privacy, special }] }
			sources: function (o) {
				return client.me(o).then(function (me) {
					return client.playlists(o).then(function (lists) {
						var out = [];
						if (me && me.likes) out.push({ id: me.likes, title: 'Liked videos', count: null, privacy: 'private', special: 'likes', publishedAt: null });
						lists.forEach(function (p) { p.special = ''; out.push(p); });
						return { me: me, sources: out };
					});
				});
			},

			// One page (50) of a playlist. -> { items: [{ videoId, addedAt,
			// position, title, unavailable }], nextPageToken, total }. 1 unit.
			playlistPage: function (playlistId, pageToken, o) {
				return get('playlistItems', { part: 'snippet,contentDetails,status', playlistId: playlistId, maxResults: 50, pageToken: pageToken || '' }, o).then(function (res) {
					return {
						total: res.pageInfo && res.pageInfo.totalResults != null ? res.pageInfo.totalResults : null,
						nextPageToken: res.nextPageToken || null,
						items: (res.items || []).map(function (it) {
							var sn = it.snippet || {}, cd = it.contentDetails || {};
							var id = cd.videoId || (sn.resourceId && sn.resourceId.videoId) || '';
							// A deleted or private video is still listed, without its owner.
							var unavailable = !sn.videoOwnerChannelTitle && !cd.videoPublishedAt;
							return { videoId: id, addedAt: sn.publishedAt || null, position: sn.position, title: sn.title || '', unavailable: unavailable };
						}).filter(function (it) { return it.videoId; })
					};
				});
			},

			// The details of up to 50 videos. -> { videos: [library records],
			// missing: [ids YouTube did not return] }. 1 unit.
			// Videos for a query (100 quota units): [{ videoId, title, channel, channelId, publishedAt }].
			// Only embeddable music videos.
			search: function (query, o) {
				o = o || {};
				return get('search', { part: 'snippet', q: String(query || ''), type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', maxResults: Math.max(1, Math.min(25, o.max || 5)) }, o).then(function (res) {
					return (res.items || []).filter(function (it) { return it.id && it.id.videoId; }).map(function (it) {
						var sn = it.snippet || {};
						return { videoId: it.id.videoId, title: sn.title || '', channel: sn.channelTitle || '', channelId: sn.channelId || '', publishedAt: sn.publishedAt || null };
					});
				});
			},
			// Add a video at the end of one of the account's playlists (50 units).
			// Needs a sign-in with WRITE_SCOPE. -> { itemId, playlistId, videoId, addedAt, position }
			addToPlaylist: function (playlistId, videoId, o) {
				var body = { snippet: { playlistId: String(playlistId), resourceId: { kind: 'youtube#video', videoId: String(videoId) } } };
				return call('POST', 'playlistItems', { part: 'snippet' }, body, o).then(function (res) {
					var sn = res.snippet || {};
					return { itemId: res.id || '', playlistId: sn.playlistId || playlistId, videoId: (sn.resourceId && sn.resourceId.videoId) || videoId, addedAt: sn.publishedAt || null, position: sn.position };
				});
			},
			// Take an added item out again (50 units). itemId: from addToPlaylist.
			removeFromPlaylist: function (itemId, o) { return call('DELETE', 'playlistItems', { id: itemId }, null, o).then(function () { return true; }); },
			videoBatch: function (ids, o) {
				if (!ids.length) return Promise.resolve({ videos: [], missing: [] });
				if (ids.length > 50) return Promise.reject(YTError('bad-request', 'At most 50 videos can be asked for at once.'));
				return get('videos', { part: 'snippet,contentDetails,status,topicDetails', id: ids.join(','), maxResults: 50 }, o).then(function (res) {
					var got = {}, videos = (res.items || []).map(toVideo);
					videos.forEach(function (v) { got[v.id] = true; });
					return { videos: videos, missing: ids.filter(function (id) { return !got[id]; }) };
				});
			}
		};
		return client;
	}

	// A videos.list item as the library wants it. Only what the page uses is
	// kept; the description is read for a release date and dropped.
	function toVideo(item) {
		var sn = item.snippet || {}, cd = item.contentDetails || {}, st = item.status || {}, td = item.topicDetails || {};
		var sec = Library.parseDuration(cd.duration);
		var auto = /^Provided to YouTube by /.test(String(sn.description || ''));
		return {
			id: item.id,
			title: sn.title || '',
			channel: sn.channelTitle || '',
			channelId: sn.channelId || '',
			durationSec: sec,
			publishedAt: sn.publishedAt || null,
			categoryId: sn.categoryId || '',
			embeddable: st.embeddable !== false,
			privacy: st.privacyStatus || '',
			topics: td.topicCategories || [],
			year: auto ? Parse.releaseYear(sn.description) : null,
			live: (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') || sec === 0
		};
	}

	// ---- Importing a playlist ----------------------------------------------------------------------

	function chunks(list, size) {
		var out = [];
		for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
		return out;
	}

	// Read one playlist into the library and the store.
	//   o.client     from createClient()
	//   o.lib        the library (library.js); changed in place
	//   o.store      the store (store.js); tracks are written batch by batch
	//   o.playlist   { id, title, privacy, special } (one of client.sources())
	//   o.onProgress({ phase: 'list' | 'details' | 'done', listed, total, detailed, toDetail, quota })
	//   o.signal     an AbortSignal to stop it
	//   o.now        the clock (default Date.now)
	//   o.freshDays  details younger than this are not fetched again (default 30)
	//
	// Two phases. "list" pages through the playlist, 50 items a call. "details"
	// asks for the videos' details, 50 a call, skipping videos the library
	// already has fresh. After every call the position is saved in the store
	// (key 'import:<playlist id>'), so when the import is interrupted (the
	// tab closed, the hour of the token over, the quota used up, the network
	// gone) calling importInto again for the same playlist goes on from there.
	// A playlist of 1,230 items costs about 50 units of the 10,000 a day.
	//
	// Listed videos that YouTube no longer returns are marked removed if the
	// library has them. Tracks that have left the playlist leave it in the
	// library too (they stay in the library). Nothing the listener did to a
	// track is touched.
	// -> { playlistId, title, total, unique, fetched, skippedFresh, missing: [ids],
	//      added: [ids], updated: [ids], left: [ids], quota, resumed }
	function importInto(o) {
		var client = o.client, lib = o.lib, store = o.store, pl = o.playlist;
		var now = o.now || function () { return Date.now(); };
		var freshMs = (o.freshDays == null ? 30 : o.freshDays) * DAY;
		var key = 'import:' + pl.id, startUnits = client.quota().units;
		var prog, resumed = false, added = [], updated = [];

		function spent() { return client.quota().units - startUnits; }
		function report(phase, toDetail) {
			if (!o.onProgress) return;
			o.onProgress({ phase: phase, listed: prog.items.length, total: prog.total, detailed: prog.detailIndex, toDetail: toDetail == null ? null : toDetail, quota: (prog.quotaBefore || 0) + spent() });
		}
		function save() { prog.quota = (prog.quotaBefore || 0) + spent(); return store.set(key, prog); }
		function stopIfAsked() { if (o.signal && o.signal.aborted) throw YTError('aborted', 'Stopped.'); }

		function listPhase() {
			if (prog.phase !== 'list') return Promise.resolve();
			stopIfAsked();
			return client.playlistPage(pl.id, prog.pageToken, { signal: o.signal }).then(function (page) {
				if (page.total != null) prog.total = page.total;
				page.items.forEach(function (it) { prog.items.push([it.videoId, it.addedAt, it.unavailable ? 1 : 0]); });
				prog.pageToken = page.nextPageToken;
				if (!page.nextPageToken) prog.phase = 'details';
				report('list');
				return save().then(listPhase);
			}, function (err) {
				// A page token that Google no longer accepts: list again from the top.
				if (err.code === 'bad-request' && prog.pageToken && !prog.restarted) {
					prog.items = []; prog.pageToken = null; prog.restarted = true;
					return listPhase();
				}
				throw err;
			});
		}

		function detailsPhase() {
			// One entry per video: a playlist may list a video twice. The
			// earliest date added is the one kept.
			var addedAt = {}, order = [], unavailable = {};
			prog.items.forEach(function (it) {
				var id = it[0];
				if (!(id in addedAt)) { order.push(id); addedAt[id] = it[1]; }
				else if (it[1] && (!addedAt[id] || it[1] < addedAt[id])) addedAt[id] = it[1];
				if (it[2]) unavailable[id] = true;
			});
			var t = now(), fresh = [], need = [], knownMissing = {}, fetched = 0;
			prog.missing.forEach(function (id) { knownMissing[id] = true; });
			order.forEach(function (id) {
				if (unavailable[id] || knownMissing[id]) return;   // knownMissing: asked before an interruption, not returned
				var have = lib.tracks[id];
				if (have && !have.removed && have.fetchedAt && t - Date.parse(have.fetchedAt) < freshMs) fresh.push(id); else need.push(id);
			});
			var batches = chunks(need, 50), missing = Object.keys(unavailable);

			// Tracks already here and fresh only need to join the playlist.
			var joined = [];
			fresh.forEach(function (id) {
				var tr = lib.tracks[id];
				if (tr.playlists.indexOf(pl.id) < 0) { tr.playlists.push(pl.id); joined.push(tr); }
				if (addedAt[id] && tr.addedAt[pl.id] !== addedAt[id]) { tr.addedAt[pl.id] = addedAt[id]; if (joined.indexOf(tr) < 0) joined.push(tr); }
			});
			joined.forEach(function (tr) { updated.push(tr.id); });

			function batch(i) {
				if (i >= batches.length) return Promise.resolve();
				stopIfAsked();
				return client.videoBatch(batches[i], { signal: o.signal }).then(function (res) {
					var r = Library.upsert(lib, res.videos, { playlistId: pl.id, addedAt: addedAt, now: now() });
					added = added.concat(r.added); updated = updated.concat(r.updated);
					fetched += res.videos.length;
					prog.missing = prog.missing.concat(res.missing);
					prog.detailIndex = i + 1;
					report('details', batches.length);
					return store.putTracks(res.videos.map(function (v) { return lib.tracks[v.id]; })).then(save).then(function () { return batch(i + 1); });
				});
			}
			// On a resume the batches already done are fresh in the library, so
			// `need` no longer holds them and counting starts at zero again.
			prog.detailIndex = 0;
			report('details', batches.length);
			return store.putTracks(joined).then(function () { return batch(0); }).then(function () {
				missing = missing.concat(prog.missing.filter(function (id) { return missing.indexOf(id) < 0; }));
				var gone = Library.markMissing(lib, missing, now());
				var rec = Library.reconcilePlaylist(lib, pl.id, order);
				Library.setPlaylist(lib, {
					id: pl.id, title: pl.title || '', privacy: pl.privacy || '', special: pl.special || '',
					count: order.length, listed: prog.items.length, unavailable: missing.length,
					importedAt: (lib.playlists[pl.id] && lib.playlists[pl.id].importedAt) || new Date(now()).toISOString(),
					refreshedAt: new Date(now()).toISOString()
				});
				// tracks whose artist was a toss-up may be settled by this playlist
				var resolved = Library.resolveArtists(lib);
				var touched = gone.concat(rec.changed).concat(resolved).filter(function (id, i, all) { return all.indexOf(id) === i; }).map(function (id) { return lib.tracks[id]; });
				var summary = {
					playlistId: pl.id, title: pl.title || '', total: prog.items.length, unique: order.length,
					fetched: fetched, skippedFresh: fresh.length, missing: missing,
					added: added, updated: updated, left: rec.changed, quota: (prog.quotaBefore || 0) + spent(), resumed: resumed
				};
				return store.putTracks(touched)
					.then(function () { return store.putPlaylists([lib.playlists[pl.id]]); })
					.then(function () { return store.saveLibraryMeta(Library.meta(lib)); })
					.then(function () { return store.remove(key); })
					.then(function () { prog.phase = 'done'; report('done', batches.length); return summary; });
			});
		}

		return store.get(key, null).then(function (saved) {
			if (saved && saved.v === 1 && saved.playlistId === pl.id && (saved.phase === 'list' || saved.phase === 'details') && Array.isArray(saved.items)) {
				prog = saved;
				prog.quotaBefore = saved.quota || 0;
				prog.missing = saved.missing || [];
				resumed = true;
			} else {
				prog = { v: 1, playlistId: pl.id, title: pl.title || '', phase: 'list', pageToken: null, total: null, items: [], detailIndex: 0, missing: [], startedAt: new Date(now()).toISOString(), quota: 0, quotaBefore: 0 };
			}
			return listPhase().then(detailsPhase).catch(function (err) {
				// Keep the count of what this attempt spent, the failed call included.
				if (prog.phase === 'done') throw err;
				return save().then(function () { throw err; }, function () { throw err; });
			});
		});
	}

	// Is there an unfinished import of this playlist? -> its saved progress
	// ({ phase, items, total, ... }) or null
	function pendingImport(store, playlistId) {
		return store.get('import:' + playlistId, null).then(function (p) { return p && p.v === 1 && p.phase !== 'done' ? p : null; });
	}

	// Fetch metadata again for tracks already in the library.
	//   o.client, o.lib, o.store, o.onProgress({ done, total, quota }), o.signal, o.now
	//   o.ids            which tracks (default: the stale ones)
	//   o.olderThanDays  what "stale" means (default 30); o.all = true takes every track
	// Titles, lengths, the embeddable flag and topics are updated; a track
	// YouTube no longer returns is marked removed; ratings, counts, history and
	// corrections stay. Tracks already marked removed are asked for again, so
	// one that came back is found. 1 unit per 50 tracks.
	// -> { checked, updated: [ids], removed: [ids], restored: [ids], quota }
	function refreshInto(o) {
		var client = o.client, lib = o.lib, store = o.store;
		var now = o.now || function () { return Date.now(); };
		var ids = o.ids || (o.all ? Object.keys(lib.tracks) : Library.stale(lib, now(), o.olderThanDays));
		var batches = chunks(ids, 50), startUnits = client.quota().units;
		var updated = [], removed = [], restored = [], done = 0;
		function batch(i) {
			if (i >= batches.length) return Promise.resolve();
			if (o.signal && o.signal.aborted) return Promise.reject(YTError('aborted', 'Stopped.'));
			return client.videoBatch(batches[i], { signal: o.signal }).then(function (res) {
				res.videos.forEach(function (v) { if (lib.tracks[v.id] && lib.tracks[v.id].removed) restored.push(v.id); });
				var r = Library.upsert(lib, res.videos, { now: now() });
				updated = updated.concat(r.updated);
				var newlyGone = Library.markMissing(lib, res.missing, now());
				removed = removed.concat(newlyGone);
				done += batches[i].length;
				if (o.onProgress) o.onProgress({ done: done, total: ids.length, quota: client.quota().units - startUnits });
				return store.putTracks(batches[i].map(function (id) { return lib.tracks[id]; }).filter(Boolean)).then(function () { return batch(i + 1); });
			});
		}
		return batch(0).then(function () {
			var resolved = Library.resolveArtists(lib).filter(function (id) { return updated.indexOf(id) < 0; });
			updated = updated.concat(resolved);
			return store.putTracks(resolved.map(function (id) { return lib.tracks[id]; }));
		}).then(function () {
			return { checked: ids.length, updated: updated, removed: removed, restored: restored, quota: client.quota().units - startUnits };
		});
	}

	// ---- MusicBrainz -----------------------------------------------------------------------------------

	// Finer genres per artist, from MusicBrainz's web service. It answers
	// browsers on other origins (Access-Control-Allow-Origin: *, checked
	// 2026-10-05) and asks for at most one request a second, which this keeps
	// to: two requests per artist (a search, then the artist with its genres).
	// Nothing is asked until the page calls it. An artist is accepted only when
	// MusicBrainz's best match has the same name (case, accents and "The"
	// aside) or lists it as an alias; anything less sure gives null.
	//   opts: { endpoints, fetch, sleep, now, gapMs (1100) }
	function createMusicBrainz(opts) {
		opts = opts || {};
		var ep = opts.endpoints || endpoints();
		var doFetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
		var now = opts.now || function () { return Date.now(); };
		var gap = opts.gapMs == null ? 1100 : opts.gapMs;
		var last = -Infinity, chain = Promise.resolve(), requests = 0;

		// One request at a time, each at least `gap` after the one before.
		function ask(path, signal) {
			var run = function () {
				if (signal && signal.aborted) return Promise.reject(YTError('aborted', 'Stopped.'));
				var wait = Math.max(0, last + gap - now());
				return (wait > 0 ? sleep(wait) : Promise.resolve()).then(function () {
					last = now();
					requests++;
					return doFetch(ep.mb + path, { headers: { Accept: 'application/json' }, signal: signal });
				}).then(function (res) {
					if (res.status === 503 || res.status === 429) {
						return res.text().then(function () { throw YTError('rate', 'MusicBrainz asked for fewer requests. Try again in a minute.'); });
					}
					if (res.status === 404) return res.text().then(function () { return null; });
					if (!res.ok) return res.text().then(function () { throw YTError('server', 'MusicBrainz answered ' + res.status + '.'); });
					return res.json();
				}, function (e) {
					if (isYTError(e)) throw e;
					if (e && e.name === 'AbortError') throw YTError('aborted', 'Stopped.');
					throw YTError('network', 'MusicBrainz could not be reached.', { detail: e && e.message });
				});
			};
			var p = chain.then(run, run);
			chain = p.then(function () {}, function () {});
			return p;
		}
		function lucene(s) { return String(s).replace(/([+\-!(){}\[\]^"~*?:\\\/]|&&|\|\|)/g, '\\$1'); }
		function title(s) { return String(s).replace(/(^|[\s\-\/])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }

		var mb = {
			requests: function () { return requests; },
			// -> { mbid, name, genres: ['Indie Rock', ...] } or null when no sure match
			artistGenres: function (name, o) {
				o = o || {};
				var want = Library.normArtist(name);
				if (!want) return Promise.resolve(null);
				return ask('/artist?query=' + encodeURIComponent('artist:"' + lucene(name) + '"') + '&limit=5&fmt=json', o.signal).then(function (res) {
					var hit = null;
					((res && res.artists) || []).forEach(function (a) {
						if (hit || !(a.score >= 90)) return;
						var names = [a.name].concat((a.aliases || []).map(function (x) { return x.name; }));
						if (names.some(function (n) { return Library.normArtist(n) === want; })) hit = a;
					});
					if (!hit) return null;
					return ask('/artist/' + encodeURIComponent(hit.id) + '?inc=genres&fmt=json', o.signal).then(function (full) {
						var genres = ((full && full.genres) || []).slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0) || (a.name < b.name ? -1 : 1); });
						return { mbid: hit.id, name: hit.name, genres: genres.slice(0, o.max || 3).map(function (g) { return title(g.name); }) };
					});
				});
			},
			// Look up several artists, one after the other, writing each answer
			// into the library. artists: [{ key, name }] (library.facets().artist).
			// o: { lib, onProgress({ done, total, name, found, hit }), signal }
			// (found: the artists found so far; hit: whether this one was)
			// -> { found: n, notFound: n, changed: [track ids] }
			genresForArtists: function (artists, o) {
				o = o || {};
				var list = artists.filter(function (a) { return a && a.key && a.name; }), found = 0, notFound = 0, changed = [];
				function step(i) {
					if (i >= list.length) return Promise.resolve({ found: found, notFound: notFound, changed: changed });
					return mb.artistGenres(list[i].name, { signal: o.signal }).then(function (r) {
						if (r && r.genres.length) {
							found++;
							if (o.lib) changed = changed.concat(Library.setArtistGenresFromMB(o.lib, list[i].key, { genres: r.genres, mbid: r.mbid, at: new Date(now()).toISOString() }));
						} else notFound++;
						if (o.onProgress) o.onProgress({ done: i + 1, total: list.length, name: list[i].name, found: found, hit: !!(r && r.genres.length) });
						return step(i + 1);
					});
				}
				return step(0);
			}
		};
		return mb;
	}

	return {
		SCOPE: SCOPE, WRITE_SCOPE: WRITE_SCOPE, canWriteScope: canWriteScope,
		GOOGLE: copy(GOOGLE),
		TERMS: TERMS,
		KEYS: { token: KEY_TOKEN, state: KEY_STATE, api: KEY_API },
		YTError: YTError, isYTError: isYTError,
		endpoints: endpoints, isLoopback: isLoopback,
		redirectUriFor: redirectUriFor, randomState: randomState, buildAuthUrl: buildAuthUrl, parseAuthResponse: parseAuthResponse, checkAuthResponse: checkAuthResponse,
		createAuth: createAuth,
		pacificDay: pacificDay, tallyQuota: tallyQuota, SEARCH_UNITS: SEARCH_UNITS, UNITS: UNITS,
		createClient: createClient, toVideo: toVideo,
		importInto: importInto, pendingImport: pendingImport, refreshInto: refreshInto,
		createMusicBrainz: createMusicBrainz
	};
});
