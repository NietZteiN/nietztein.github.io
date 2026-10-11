/*
 * True Shuffle: the free sources of new songs, and the network and cache
 * layer under them.
 *
 *   var S = TrueShuffle.sources;
 *   var http = S.createHttp({ hosts: S.endpointsFor(TrueShuffle.yt.endpoints()) });
 *   var cache = S.createCache({ store: store });          // store.js's cache calls
 *   S.animeThemes(http, cache).anime('some_slug').then(function (a) { ... a.themes ... });
 *
 * createHttp is the only thing here that talks to a network. Each source
 * has its own line: requests leave in order, a set time apart (`gap`), at
 * most `at` at once; a 429 waits for Retry-After and tries again, a 5xx or
 * a network failure waits 1 s, 2 s, 4 s and tries again (up to `tries`),
 * and three failures in a row close the line for a minute. Identical
 * requests in flight share one answer. Every request goes without cookies
 * or a referrer and carries nothing about the listener: only the names
 * asked about (and the Last.fm key, to Last.fm only).
 *
 * createCache keeps answers in the store's cache (IndexedDB) with an
 * in-memory front. Anything from YouTube (keys 'yt:' and 'oe:') is kept 30
 * days at most, whatever was asked, as YouTube's terms require.
 *
 * The clients turn each source's answers into finds (S.find): one shape for
 * a song found anywhere, whose `key` names where it came from. Callers never
 * see a source's raw JSON.
 *
 * Errors are SourceError objects with a `code` ('network' 'offline' 'rate'
 * 'server' 'not-found' 'bad' 'auth' 'aborted' 'down'), a `message` that is a
 * sentence for the reader naming the source, `host` and `status`.
 *
 * UMD: window.TrueShuffle.sources in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, node ? require('./discover.js') : (root.TrueShuffle || {}).discover);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.sources = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, DX) {
	'use strict';

	var MIN = 60000, HOUR = 3600000, DAY = 86400000;
	var DOWN_MS = MIN;            // how long a line stays closed after STRIKES failures in a row
	var STRIKES = 3;
	var LONGEST_WAIT = 2 * MIN;   // a Retry-After longer than this is not waited for
	var YOUTUBE_MAX = 30 * DAY;   // nothing from YouTube is kept longer
	var SEASONS = ['winter', 'spring', 'summer', 'fall'];

	// Every source, as createHttp takes them: base address, milliseconds
	// between starts, requests at once, attempts in all. name is what the
	// reader is told.
	var HOSTS = {
		animethemes: { base: 'https://api.animethemes.moe', gap: 700, at: 1, tries: 3, name: 'AnimeThemes' },
		anilist: { base: 'https://graphql.anilist.co', gap: 1000, at: 1, tries: 2, name: 'AniList' },
		// Apple answers 403 (or 429) when asked too often: the whole line waits a minute.
		itunes: { base: 'https://itunes.apple.com', gap: 3100, at: 1, tries: 2, pauseOn: [403, 429], pauseMs: 60000, name: 'iTunes' },
		// Last.fm puts its errors in the body: { error: 10, message }.
		lastfm: {
			base: 'https://ws.audioscrobbler.com/2.0', gap: 250, at: 2, tries: 2, name: 'Last.fm',
			errors: { 6: 'not-found', 8: 'server', 10: 'auth', 11: 'server', 16: 'server', 26: 'auth', 29: 'rate' },
			rateMs: 30000,
			authText: 'Last.fm did not accept the API key. Check it in Settings.'
		},
		oembed: { base: 'https://www.youtube.com', gap: 150, at: 3, tries: 1, name: 'YouTube' },
		vndb: { base: 'https://api.vndb.org/kana', gap: 1500, at: 1, tries: 2, name: 'VNDB' }
	};

	// How long each kind of answer is kept (ms).
	var TTL = {
		oembed: 30 * DAY, oembedNo: 7 * DAY,
		ytRes: 30 * DAY, ytResNo: 7 * DAY,
		listRD: 2 * DAY, listUU: 6 * HOUR, listPL: 7 * DAY,
		atSearch: 7 * DAY, atAnimeAiring: 14 * DAY, atAnime: 180 * DAY, atSeries: 30 * DAY, atArtist: 30 * DAY, atSeason: DAY, atTrack: 90 * DAY,
		alSeason: DAY,
		itSearch: 30 * DAY, itArtist: 7 * DAY, itAlbums: 3 * DAY, itAlbum: 90 * DAY,
		lfm: 14 * DAY,
		dz: 7 * DAY
	};

	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function clamp(n, lo, hi) { n = Math.round(+n); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function listOf(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
	function uniq(list) { var seen = {}; return list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }
	function chunks(list, size) { var out = []; for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; }
	// Names compared without case, accents, punctuation or a leading "the"
	// (discover.js's norm, which match.js calls fold).
	function fold(s) {
		if (DX && DX.norm) return DX.norm(s);
		return str(s).normalize('NFKC').normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}
	// A query as a cache key: trimmed, lower case, single spaces.
	function qkey(q) { return str(q).trim().toLowerCase().replace(/\s+/g, ' '); }
	function hostOf(u) { var m = /^https?:\/\/([^/?#]+)/i.exec(str(u)); return m ? m[1] : str(u); }

	// ---- Errors -----------------------------------------------------------------------

	function SourceError(code, message, extra) {
		var e = new Error(message);
		e.name = 'SourceError';
		e.code = code;
		if (extra) for (var k in extra) if (extra[k] !== undefined) e[k] = extra[k];
		return e;
	}
	function isSourceError(e) { return !!e && e.name === 'SourceError'; }
	function stopped() { return SourceError('aborted', 'Stopped.'); }

	// A promise that also rejects ('aborted') when the signal fires.
	function withSignal(p, signal) {
		if (!signal || !signal.addEventListener) return p;
		return new Promise(function (resolve, reject) {
			if (signal.aborted) { reject(stopped()); return; }
			var onAbort = function () { reject(stopped()); };
			signal.addEventListener('abort', onAbort);
			p.then(function (v) { signal.removeEventListener('abort', onAbort); resolve(v); }, function (e) { signal.removeEventListener('abort', onAbort); reject(e); });
		});
	}

	// ---- Where to talk to -------------------------------------------------------------

	// The hosts map for createHttp. The real addresses, unless ep (from
	// yt.js endpoints()) is the local fake (?api= on localhost): then every
	// source goes to the fake, under /animethemes, /anilist, /itunes,
	// /lastfm, /vndb, and oEmbed at the fake's own /oembed.
	function endpointsFor(ep) {
		var out = copy(HOSTS);
		if (!ep || !ep.test) return out;
		var base = str(ep.base || str(ep.api).replace(/\/youtube\/v3\/?$/, '')).replace(/\/+$/, '');
		if (!base) return out;
		out.animethemes.base = base + '/animethemes';
		out.anilist.base = base + '/anilist';
		out.itunes.base = base + '/itunes';
		out.lastfm.base = base + '/lastfm';
		out.oembed.base = base;
		out.vndb.base = base + '/vndb';
		return out;
	}

	// ---- The network ------------------------------------------------------------------

	// opts: { fetch, now, sleep(ms) -> Promise, onLine() -> bool, hosts (HOSTS) }
	function createHttp(opts) {
		opts = opts || {};
		var doFetch = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var now = opts.now || function () { return Date.now(); };
		var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
		var onLine = opts.onLine || function () { var n = root.navigator; return !n || n.onLine !== false; };
		var cfgs = opts.hosts || HOSTS;
		var lines = {}, inflight = {};

		// One line per source; an absolute base address that is not one of
		// the sources gets a line of its own.
		function lineFor(h) {
			var k = str(h), bare = k.replace(/\/+$/, '');
			if (!cfgs[k]) Object.keys(cfgs).forEach(function (n) { if (cfgs[n].base === bare) k = n; });
			if (lines[k]) return lines[k];
			var cfg = cfgs[k];
			if (!cfg) {
				if (!/^https?:\/\/[^/?#]+/i.test(k)) return null;
				k = bare;
				if (lines[k]) return lines[k];
				cfg = { base: bare, gap: 0, at: 2, tries: 2, name: hostOf(bare) };
			}
			lines[k] = { key: k, cfg: cfg, queue: [], active: 0, nextAt: -Infinity, waking: false, fails: 0, downUntil: -Infinity, sent: 0, failed: 0 };
			return lines[k];
		}
		function isDown(line) { return line.downUntil > now(); }
		function nameOf(line) { return line.cfg.name || line.key; }

		function problem(code, line, extra) {
			var n = nameOf(line), text;
			if (code === 'network') text = n + ' could not be reached. Check the connection and try again.';
			else if (code === 'offline') text = 'This device is offline, so ' + n + ' cannot be asked.';
			else if (code === 'rate') text = n + ' asked for fewer requests. Try again in a minute.';
			else if (code === 'server') text = n + ' is having trouble answering. Try again later.';
			else if (code === 'not-found') text = n + ' has nothing under that name.';
			else if (code === 'auth') text = line.cfg.authText || n + ' refused the request.';
			else if (code === 'aborted') text = 'Stopped.';
			else if (code === 'down') text = n + ' is not answering; trying again in a minute.';
			else text = extra && extra.unreadable ? n + ' sent an answer this page cannot read.' : n + ' did not accept the request.';
			var e = SourceError(code, text, { host: line.key, status: extra && extra.status, body: extra && extra.body, detail: extra && extra.detail });
			return e;
		}

		function queryString(q, path) {
			if (!q) return '';
			var parts = [];
			Object.keys(q).forEach(function (k) {
				var v = q[k];
				if (v == null || v === '') return;
				parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
			});
			return parts.length ? (path.indexOf('?') >= 0 ? '&' : '?') + parts.join('&') : '';
		}

		function request(method, h, path, body, o) {
			o = o || {};
			var line = lineFor(h);
			if (!line) return Promise.reject(SourceError('bad', 'There is no source called "' + str(h) + '".', { host: str(h) }));
			var p = str(path), base = line.cfg.base;
			// A full address (a "next page" link) must stay on the source's own base.
			if (/^https?:\/\//i.test(p)) {
				if (p !== base && p.indexOf(base + '/') !== 0 && p.indexOf(base + '?') !== 0) return Promise.reject(problem('bad', line, { detail: 'an address outside ' + base }));
				p = p.slice(base.length);
			}
			var url = base + p + queryString(o.query, p);
			var text = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
			if (o.signal && o.signal.aborted) return Promise.reject(problem('aborted', line));
			if (!onLine()) return Promise.reject(problem('offline', line));
			if (isDown(line)) return Promise.reject(problem('down', line));
			if (!doFetch) return Promise.reject(problem('network', line, { detail: 'no fetch' }));
			var key = method + ' ' + url + (text == null ? '' : '\n' + text);
			var job = inflight[key], fresh = !job;
			if (fresh) job = inflight[key] = { key: key, line: line, method: method, url: url, body: text, callers: [], state: 'queued', tries: 0, ctl: null, cancelled: false };
			var promise = new Promise(function (resolve, reject) {
				var caller = { resolve: resolve, reject: reject, off: null };
				job.callers.push(caller);
				if (o.signal && o.signal.addEventListener) {
					var onAbort = function () { leave(job, caller); };
					o.signal.addEventListener('abort', onAbort);
					caller.off = function () { o.signal.removeEventListener('abort', onAbort); };
				}
			});
			if (fresh) { line.queue.push(job); pump(line); }
			return promise;
		}

		// A caller's signal fired: that caller is told 'aborted'. A request
		// nobody waits for any more leaves the line, or is cut off if sent.
		function leave(job, caller) {
			var i = job.callers.indexOf(caller);
			if (i < 0) return;
			job.callers.splice(i, 1);
			if (caller.off) caller.off();
			caller.reject(problem('aborted', job.line));
			if (job.callers.length || job.state === 'done') return;
			job.cancelled = true;
			if (inflight[job.key] === job) delete inflight[job.key];
			var q = job.line.queue.indexOf(job);
			if (q >= 0) job.line.queue.splice(q, 1);
			if (job.state === 'sent' && job.ctl) { try { job.ctl.abort(); } catch (e) { /* already over */ } }
		}

		function pump(line) {
			var most = Math.max(1, +line.cfg.at || 1);
			while (line.queue.length && line.active < most) {
				var wait = line.nextAt - now();
				if (wait > 0) { wake(line, wait); return; }
				send(line, line.queue.shift());
			}
		}
		function wake(line, ms) {
			if (line.waking) return;
			line.waking = true;
			sleep(ms).then(function () { line.waking = false; pump(line); });
		}

		function send(line, job) {
			if (!onLine()) { finish(job, problem('offline', line)); return; }
			if (isDown(line)) { finish(job, problem('down', line)); return; }
			job.state = 'sent';
			job.tries++;
			line.active++;
			line.sent++;
			line.nextAt = now() + (+line.cfg.gap || 0);
			var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
			job.ctl = ctl;
			var headers = { Accept: 'application/json' };
			var init = { method: job.method, headers: headers, credentials: 'omit', referrerPolicy: 'no-referrer' };
			if (job.body != null) { headers['Content-Type'] = 'application/json'; init.body = job.body; }
			if (ctl) init.signal = ctl.signal;
			var p;
			try { p = Promise.resolve(doFetch(job.url, init)); } catch (e) { p = Promise.reject(e); }
			p.then(function (res) {
				return readBody(res).then(function (b) { return { res: res, body: b }; });
			}).then(function (r) {
				line.active--;
				if (!job.cancelled) answered(line, job, r.res, r.body);
			}, function (e) {
				line.active--;
				if (!job.cancelled) unreachable(line, job, e);
			}).then(null, function (e) {
				finish(job, problem('bad', line, { detail: e && e.message }));
			}).then(function () { pump(line); });
		}

		function readBody(res) {
			var t = res && typeof res.text === 'function' ? res.text()
				: res && typeof res.json === 'function' ? res.json().then(function (j) { return JSON.stringify(j); })
				: Promise.resolve('');
			return t.then(function (text) {
				var json;
				try { json = text ? JSON.parse(text) : undefined; } catch (e) { json = undefined; }
				return { text: str(text), json: json };
			});
		}

		function retryAfter(res) {
			var v = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
			if (v == null || v === '') return null;
			if (/^\s*\d+(\.\d+)?\s*$/.test(v)) return Math.round(parseFloat(v) * 1000);
			var t = Date.parse(v);
			return isNaN(t) ? null : Math.max(0, t - now());
		}
		function backoff(job) { return 1000 * Math.pow(2, Math.max(0, job.tries - 1)); }
		function statusCode(cfg, status) {
			if (cfg.pauseOn && cfg.pauseOn.indexOf(status) >= 0) return 'rate';
			if (status === 429) return 'rate';
			if (status === 404 || status === 410) return 'not-found';
			if (status === 401 || status === 403) return 'auth';
			if (status >= 500) return 'server';
			return 'bad';
		}
		// An error a source puts in the body of its answer (Last.fm's numbers).
		function bodyCode(cfg, json) {
			if (!cfg.errors || !json || typeof json !== 'object' || json.error == null || typeof json.error === 'object') return '';
			return cfg.errors[json.error] || 'bad';
		}

		function answered(line, job, res, body) {
			var status = +res.status || 0, cfg = line.cfg, json = body.json;
			var fromBody = bodyCode(cfg, json), code = fromBody;
			if (!code) {
				if (status >= 200 && status < 300) {
					line.fails = 0;
					if (json === undefined) { finish(job, problem('bad', line, { status: status, unreadable: true, body: body.text.slice(0, 200) })); return; }
					finish(job, null, json);
					return;
				}
				code = statusCode(cfg, status);
			}
			var extra = { status: status, body: json !== undefined ? json : body.text.slice(0, 200) };
			if (code === 'rate' || code === 'server') {
				line.failed++;
				if (code === 'server') strike(line);
				var more = job.tries < Math.max(1, +cfg.tries || 1) && !isDown(line);
				if (more && code === 'rate') {
					var after = retryAfter(res), wait;
					if (fromBody && cfg.rateMs) wait = Math.max(after || 0, cfg.rateMs);
					else if (cfg.pauseOn && cfg.pauseOn.indexOf(status) >= 0) wait = Math.max(after || 0, cfg.pauseMs || MIN);
					else wait = after != null ? after : backoff(job);
					if (wait <= LONGEST_WAIT) {
						// The whole line waits: the source asked for fewer requests, not this one.
						line.nextAt = Math.max(line.nextAt, now() + wait);
						requeue(line, job, 0);
						return;
					}
				} else if (more) { requeue(line, job, backoff(job)); return; }
			} else line.fails = 0;
			finish(job, problem(code, line, extra));
		}

		function unreachable(line, job, e) {
			if (e && e.name === 'AbortError') { finish(job, problem('aborted', line)); return; }
			if (!onLine()) { finish(job, problem('offline', line)); return; }
			line.failed++;
			strike(line);
			if (job.tries < Math.max(1, +line.cfg.tries || 1) && !isDown(line)) { requeue(line, job, backoff(job)); return; }
			finish(job, problem('network', line, { detail: e && e.message }));
		}

		// A failure: the third in a row closes the line for a minute, and
		// what waits in it is told so at once.
		function strike(line) {
			line.fails++;
			if (line.fails < STRIKES) return;
			line.fails = 0;
			line.downUntil = now() + DOWN_MS;
			line.queue.splice(0).forEach(function (j) { finish(j, problem('down', line)); });
		}

		function requeue(line, job, wait) {
			job.state = 'waiting';
			var back = function () {
				if (job.cancelled || job.state === 'done') return;
				job.state = 'queued';
				line.queue.unshift(job);
				pump(line);
			};
			if (wait > 0) sleep(wait).then(back); else back();
		}

		function finish(job, err, json) {
			if (job.state === 'done') return;
			job.state = 'done';
			if (inflight[job.key] === job) delete inflight[job.key];
			var callers = job.callers;
			job.callers = [];
			callers.forEach(function (c) { if (c.off) c.off(); if (err) c.reject(err); else c.resolve(json); });
		}

		return {
			now: now,
			// -> Promise of the answer's JSON. o: { query: { name: value }, signal }
			get: function (host, path, o) { return request('GET', host, path, null, o); },
			// body: an object (sent as JSON) or a string. o: { signal }
			post: function (host, path, body, o) { return request('POST', host, path, body == null ? {} : body, o); },
			// -> { host: { sent, failed, queued, active, down } }
			stats: function () {
				var out = {};
				Object.keys(cfgs).concat(Object.keys(lines)).forEach(function (k) {
					var l = lines[k];
					out[k] = l ? { sent: l.sent, failed: l.failed, queued: l.queue.length, active: l.active, down: isDown(l) } : { sent: 0, failed: 0, queued: 0, active: 0, down: false };
				});
				return out;
			}
		};
	}

	// ---- The cache --------------------------------------------------------------------

	// opts: { store (store.js; without one the cache is memory only), now,
	//         memoryMax (300 entries in the in-memory front) }
	function createCache(opts) {
		opts = opts || {};
		var store = opts.store || null;
		var now = opts.now || function () { return Date.now(); };
		var most = opts.memoryMax == null ? 300 : Math.max(0, +opts.memoryMax || 0);
		var mem = new Map(), hits = 0, misses = 0, pending = {};

		function ttlFor(key, ms) {
			ms = +ms;
			if (!(ms > 0)) ms = 0;
			if (ms === Infinity) ms = 3650 * DAY;
			return /^(?:yt|oe):/.test(key) ? Math.min(ms, YOUTUBE_MAX) : ms;
		}
		function remember(key, row) {
			if (!most) return;
			mem.delete(key);
			mem.set(key, row);
			while (mem.size > most) mem.delete(mem.keys().next().value);
		}
		function recall(key) {
			var r = mem.get(key);
			if (!r) return null;
			if (r.exp <= now()) { mem.delete(key); return null; }
			mem.delete(key);
			mem.set(key, r);
			return r;
		}
		function negTtl(o, ttl) {
			if (o && o.negTtlMs != null) return o.negTtlMs;
			return Math.min(typeof ttl === 'number' ? ttl : 7 * DAY, 7 * DAY);
		}

		var cache = {
			now: now,
			// -> the value, or undefined when there is none (null is a stored "no")
			get: function (key) {
				key = str(key);
				var r = recall(key);
				if (r) { hits++; return Promise.resolve(copy(r.value)); }
				if (!store) { misses++; return Promise.resolve(undefined); }
				return store.cacheGet([key], { now: now(), rows: true }).then(function (o) {
					var row = o[key];
					if (!row) { misses++; return undefined; }
					hits++;
					remember(key, { value: row.value, exp: row.exp, at: row.at });
					return copy(row.value);
				}, function () { misses++; return undefined; });
			},
			// -> { key: value } for the keys that are there, in the order asked
			getMany: function (keys) {
				var asked = uniq(listOf(keys).map(str)), found = {}, rest = [];
				asked.forEach(function (k) {
					var r = recall(k);
					if (r) { hits++; found[k] = copy(r.value); } else rest.push(k);
				});
				function ordered() { var out = {}; asked.forEach(function (k) { if (k in found) out[k] = found[k]; }); return out; }
				if (!rest.length) return Promise.resolve(ordered());
				if (!store) { misses += rest.length; return Promise.resolve(ordered()); }
				return store.cacheGet(rest, { now: now(), rows: true }).then(function (o) {
					rest.forEach(function (k) {
						var row = o[k];
						if (!row) { misses++; return; }
						hits++;
						remember(k, { value: row.value, exp: row.exp, at: row.at });
						found[k] = copy(row.value);
					});
					return ordered();
				}, function () { misses += rest.length; return ordered(); });
			},
			// Keep value for ttlMs ('yt:' and 'oe:' keys: 30 days at most). A
			// store that refuses (full, say) leaves the in-memory copy.
			put: function (key, value, ttlMs) {
				key = str(key);
				if (value === undefined || !key) return Promise.resolve();
				var t = now(), exp = t + ttlFor(key, ttlMs), v = copy(value);
				remember(key, { value: v, exp: exp, at: t });
				if (!store) return Promise.resolve();
				return store.cachePut([{ key: key, value: v, exp: exp, at: t }], { now: t }).then(function () {}, function () {});
			},
			// The cached value, else fn()'s, kept for ttlMs (or ttlMs(value)).
			// A SourceError 'not-found' from fn, or a null result, is kept as a
			// "no" (null) for o.negTtlMs (default: ttlMs, at most 7 days) and
			// resolves null. Calls for one key at the same time share one fn().
			// o: { negTtlMs, signal }
			wrap: function (key, ttlMs, fn, o) {
				o = o || {};
				key = str(key);
				var signal = o.signal;
				if (signal && signal.aborted) return Promise.reject(stopped());
				var mine = !pending[key], p = pending[key];
				if (mine) {
					p = cache.get(key).then(function (v) {
						if (v !== undefined) return v;
						return Promise.resolve().then(fn).then(function (res) {
							if (res === undefined) return res;
							var ms = res === null ? negTtl(o, ttlMs) : typeof ttlMs === 'function' ? ttlMs(res) : ttlMs;
							return cache.put(key, res, ms).then(function () { return res; });
						}, function (e) {
							if (isSourceError(e) && e.code === 'not-found') return cache.put(key, null, negTtl(o, ttlMs)).then(function () { return null; });
							throw e;
						});
					});
					pending[key] = p;
					var done = function () { if (pending[key] === p) delete pending[key]; };
					p.then(done, done);
				}
				var out = withSignal(p, signal);
				if (mine) return out;
				// Shared with a caller who gave up (its signal stopped the work):
				// this caller, still waiting, starts it again.
				return out.then(null, function (e) {
					if (isSourceError(e) && e.code === 'aborted' && !(signal && signal.aborted)) return cache.wrap(key, ttlMs, fn, o);
					throw e;
				});
			},
			// -> [{ key, value, exp, at }], unexpired, for keys starting with prefix
			range: function (prefix) {
				prefix = str(prefix);
				var t = now(), byKey = {};
				var fromMem = function () { mem.forEach(function (r, k) { if (k.indexOf(prefix) === 0 && r.exp > t) byKey[k] = { key: k, value: copy(r.value), exp: r.exp, at: r.at }; }); };
				var sorted = function () { return Object.keys(byKey).sort().map(function (k) { return byKey[k]; }); };
				if (!store) { fromMem(); return Promise.resolve(sorted()); }
				return store.cacheRange(prefix, { now: t }).then(function (rows) {
					rows.forEach(function (r) { byKey[r.key] = r; });
					fromMem();
					return sorted();
				}, function () { fromMem(); return sorted(); });
			},
			// Expired entries go; the store also keeps to its limits (store.js
			// cacheSweep). o: { maxRows, maxBytes } -> { expired, evicted, rows, bytes }
			sweep: function (o) {
				o = o || {};
				var t = now(), expired = 0;
				Array.from(mem.keys()).forEach(function (k) { if (mem.get(k).exp <= t) { mem.delete(k); expired++; } });
				if (!store) {
					var bytes = 0;
					mem.forEach(function (r, k) { bytes += k.length + (JSON.stringify(r.value) || '').length; });
					return Promise.resolve({ expired: expired, evicted: 0, rows: mem.size, bytes: bytes });
				}
				return store.cacheSweep({ now: t, maxRows: o.maxRows, maxBytes: o.maxBytes });
			},
			// Forget the keys that start with prefix (everything without one).
			clear: function (prefix) {
				prefix = str(prefix);
				Array.from(mem.keys()).forEach(function (k) { if (k.indexOf(prefix) === 0) mem.delete(k); });
				return store ? store.cacheClear(prefix || undefined) : Promise.resolve();
			},
			// Forget these exact keys.
			remove: function (keys) {
				keys = listOf(keys).map(str);
				keys.forEach(function (k) { mem.delete(k); });
				return store ? store.cacheDelete(keys) : Promise.resolve();
			},
			// rows: entries in the in-memory front
			stats: function () { return { hits: hits, misses: misses, rows: mem.size }; }
		};
		return cache;
	}

	// ---- The find -----------------------------------------------------------------------

	var FIND = {
		key: '', videoId: null, title: '', titleAlt: '', artist: '', artistNative: '', people: [], album: '', albumId: '',
		work: '', workKey: '', series: '', seriesKey: '', role: '', seq: 0, season: null, year: 0, durationSec: 0, version: '',
		cover: '', preview: '', channel: '', channelId: '', source: '', ids: {}, why: [], score: 0, at: 0
	};
	var SAFE_PATH = '\\/[^\\s"\'<>\\\\]*$';
	var IMAGE_HOSTS = new RegExp('^https:\\/\\/(?:is[0-9]+-ssl\\.mzstatic\\.com|s4\\.anilist\\.co|i\\.ytimg\\.com|e-cdns-images\\.dzcdn\\.net|cdn-images\\.dzcdn\\.net)' + SAFE_PATH);
	var PREVIEW_HOSTS = new RegExp('^https:\\/\\/(?:audio-ssl\\.itunes\\.apple\\.com|cdnt-preview\\.dzcdn\\.net|cdns-preview-[a-z0-9]+\\.dzcdn\\.net)' + SAFE_PATH);
	// Pictures only from Apple's, AniList's, YouTube's and Deezer's image hosts.
	function okImage(url) { return typeof url === 'string' && IMAGE_HOSTS.test(url); }
	// 30-second previews only from Apple's and Deezer's preview hosts.
	function okPreview(url) { return typeof url === 'string' && PREVIEW_HOSTS.test(url); }

	// Where a find came from, as its key.
	function keyOf(f) {
		var ids = f.ids, src = f.source;
		var name = f.artist || f.title ? 'lfm:' + fold(f.artist) + '|' + fold(f.title) : '';
		if (src === 'animethemes' && ids.at != null) return 'at:song:' + ids.at;
		if (src === 'itunes' && ids.it != null) return 'it:track:' + ids.it;
		if (src === 'deezer' && ids.dz != null) return 'dz:track:' + ids.dz;
		if (src === 'lastfm' && name) return name;
		if (ids.at != null) return 'at:song:' + ids.at;
		if (ids.it != null) return 'it:track:' + ids.it;
		if (ids.dz != null) return 'dz:track:' + ids.dz;
		if (f.videoId) return 'v:' + f.videoId;
		return name;
	}

	// Every field of a find, the given ones first checked: strings are
	// strings, numbers numbers, a cover or preview from an unknown host is
	// dropped, and the key is made when missing. Fields outside the shape are
	// kept as they are.
	function find(fields) {
		var f = fields || {}, out = {};
		Object.keys(FIND).forEach(function (k) {
			var d = FIND[k], v = f[k];
			if (k === 'videoId') out[k] = v ? String(v) : null;
			else if (k === 'season') out[k] = v && typeof v === 'object' && (v.year || v.season) ? { year: num(v.year), season: str(v.season).toLowerCase() } : null;
			else if (k === 'ids') {
				out[k] = {};
				if (v && typeof v === 'object') Object.keys(v).forEach(function (i) { if (v[i] != null && v[i] !== '') out[k][i] = v[i]; });
			}
			else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v.slice() : [];
			else if (typeof d === 'number') out[k] = num(v);
			else out[k] = v == null ? '' : String(v);
		});
		Object.keys(f).forEach(function (k) { if (!(k in FIND) && f[k] !== undefined) out[k] = f[k]; });
		if (!okImage(out.cover)) out.cover = '';
		if (!okPreview(out.preview)) out.preview = '';
		if (!out.key) out.key = keyOf(out);
		return out;
	}

	// The anime season a moment falls in (UTC): { year, season }.
	function seasonAt(ms) {
		var d = new Date(ms == null ? Date.now() : ms);
		return { year: d.getUTCFullYear(), season: SEASONS[Math.floor(d.getUTCMonth() / 3)] };
	}
	function seasonIndex(year, season) { var i = SEASONS.indexOf(str(season).toLowerCase()); return num(year) * 4 + (i < 0 ? 0 : i); }

	// ---- YouTube oEmbed: a video's title and channel, without quota -------------------

	function oEmbed(http, cache) {
		var ID = /^[A-Za-z0-9_-]{11}$/;
		// -> { id, title, channel, channelId (a /channel/UC... author), handle (an /@... author), ok: true }
		//    or { id, ok: false, reason: 'not-embeddable' | 'not-found' }
		function video(id, o) {
			o = o || {};
			id = str(id);
			if (!ID.test(id)) return Promise.resolve({ id: id, ok: false, reason: 'not-found' });
			return cache.wrap('oe:' + id, function (r) { return r && r.ok ? TTL.oembed : TTL.oembedNo; }, function () {
				return http.get('oembed', '/oembed', { query: { url: 'https://www.youtube.com/watch?v=' + id, format: 'json' }, signal: o.signal }).then(function (j) {
					var r = { id: id, title: str(j && j.title), channel: str(j && j.author_name) };
					var au = str(j && j.author_url), m = /\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(au), hm = /\/(@[^/?#]+)/.exec(au);
					if (m) r.channelId = m[1];
					if (hm) { try { r.handle = decodeURIComponent(hm[1]); } catch (e) { r.handle = hm[1]; } }
					r.ok = true;
					return r;
				}, function (e) {
					// 401: the owner does not allow embedding (or the video is private)
					if (isSourceError(e) && (e.status === 401 || e.status === 403)) return { id: id, ok: false, reason: 'not-embeddable' };
					if (isSourceError(e) && (e.code === 'not-found' || e.status === 400)) return { id: id, ok: false, reason: 'not-found' };
					throw e;
				});
			}, { signal: o.signal });
		}
		return {
			video: video,
			// Four at a time; -> answers in the order of ids. Rejects with the
			// first error that is not an answer (offline, down); what was read
			// stays cached.
			videos: function (ids, o) {
				ids = listOf(ids);
				var out = new Array(ids.length), next = 0, failed = null;
				function worker() {
					if (failed || next >= ids.length) return Promise.resolve();
					var k = next++;
					return video(ids[k], o).then(function (r) { out[k] = r; return worker(); }, function (e) { failed = failed || e; throw e; });
				}
				var workers = [];
				for (var w = 0; w < Math.min(4, ids.length); w++) workers.push(worker());
				return Promise.all(workers).then(function () { return out; });
			}
		};
	}

	// ---- AnimeThemes: every opening, ending and insert song of an anime ----------------

	var ROLES = { OP: 'OP', ED: 'ED', IN: 'insert' };
	var ROLE_ORDER = { OP: 0, ED: 1, insert: 2 };

	function seasonName(s) { return str(s).toLowerCase(); }
	function animeSummary(a) { return { slug: str(a.slug), name: str(a.name), year: num(a.year), season: seasonName(a.season) }; }
	function byAired(a, b) { return seasonIndex(a.year, a.season) - seasonIndex(b.year, b.season) || (str(a.name) < str(b.name) ? -1 : str(a.name) > str(b.name) ? 1 : 0); }
	function byRelevance(a, b) {
		var x = a.artistsong && a.artistsong.relevance, y = b.artistsong && b.artistsong.relevance;
		return (x == null ? 1e9 : +x) - (y == null ? 1e9 : +y);
	}
	function artistsOf(list) { return listOf(list).filter(function (x) { return x && x.name; }).slice().sort(byRelevance); }
	// 'A & B', or 'Character (CV: Singer)' for a singer credited as a part:
	// the form library.js people() reads.
	function creditOf(list) {
		return artistsOf(list).map(function (x) {
			var as = x.artistsong && x.artistsong.as;
			return as ? str(as) + ' (CV: ' + str(x.name) + ')' : str(x.name);
		}).join(' & ');
	}
	function peopleOf(list) { return uniq(artistsOf(list).map(function (x) { return str(x.name); })); }
	function seqOf(t) {
		if (t.sequence != null && isFinite(+t.sequence)) return +t.sequence;
		var m = /(\d+)/.exec(str(t.slug));
		return m ? +m[1] : 0;
	}
	function resourcesOf(list) {
		var out = { anilist: null, mal: null };
		listOf(list).forEach(function (r) {
			var site = str(r && r.site).toLowerCase(), id = r && r.external_id != null ? +r.external_id : null;
			if (!id) return;
			if (site === 'anilist') out.anilist = id;
			if (site === 'myanimelist') out.mal = id;
		});
		return out;
	}
	function byRole(a, b) { return (ROLE_ORDER[a.role] == null ? 3 : ROLE_ORDER[a.role]) - (ROLE_ORDER[b.role] == null ? 3 : ROLE_ORDER[b.role]) || a.seq - b.seq; }
	// One theme as a find. a: the anime; ser: { name, slug } or null; res: { anilist, mal }
	function themeFind(t, a, ser, res) {
		var song = t && t.song;
		if (!song || !str(song.title)) return null;
		var ids = { at: t.id };
		if (res && res.anilist) ids.anilist = res.anilist;
		if (res && res.mal) ids.mal = res.mal;
		return find({
			key: 'at:song:' + (song.id != null ? song.id : t.id),
			title: song.title, artist: creditOf(song.artists), people: peopleOf(song.artists),
			work: a.name, workKey: 'at:anime:' + a.slug,
			series: ser ? ser.name : '', seriesKey: ser ? 'at:series:' + ser.slug : '',
			role: ROLES[str(t.type).toUpperCase()] || '', seq: seqOf(t),
			season: a.year ? { year: a.year, season: seasonName(a.season) } : null, year: a.year,
			source: 'animethemes', ids: ids
		});
	}
	// An anime's themes as finds, OP then ED then inserts, each by sequence,
	// one per song.
	function themesOf(a, ser, res) {
		var seen = {}, out = [];
		listOf(a.animethemes).forEach(function (t) {
			var f = themeFind(t, { name: str(a.name), slug: str(a.slug), year: num(a.year), season: a.season }, ser, res);
			if (f && !seen[f.key]) { seen[f.key] = true; out.push(f); }
		});
		return out.sort(byRole);
	}

	function animeThemes(http, cache) {
		var nested = null;     // does /series take include=anime.animethemes...? (the real API says no)
		function get(path, query, o) { return http.get('animethemes', path, { query: query, signal: o && o.signal }); }
		function bad() { return SourceError('bad', 'AnimeThemes sent an answer this page cannot read.', { host: 'animethemes' }); }
		function airing(a) {
			if (!a || !a.year) return false;
			var cur = seasonAt(cache.now());
			if (!a.season) return a.year >= cur.year;
			return seasonIndex(a.year, a.season) >= seasonIndex(cur.year, cur.season) - 1;
		}
		function animeOf(a) {
			var ser = listOf(a.series)[0] || null, res = resourcesOf(a.resources);
			var out = animeSummary(a);
			out.format = str(a.media_format);
			out.series = listOf(a.series).map(function (s) { return str(s.slug); });
			out.resources = res;
			out.synonyms = listOf(a.animesynonyms).map(function (s) { return str(s && s.text); }).filter(Boolean);
			out.themes = themesOf(a, ser ? { name: str(ser.name), slug: str(ser.slug) } : null, res);
			return out;
		}
		function songOf(s) {
			return {
				id: s.id, title: str(s.title), artists: peopleOf(s.artists), credit: creditOf(s.artists),
				anime: listOf(s.animethemes).filter(function (t) { return t && t.anime; }).map(function (t) {
					var a = animeSummary(t.anime);
					a.role = ROLES[str(t.type).toUpperCase()] || '';
					a.seq = seqOf(t);
					a.themeId = t.id;
					return a;
				})
			};
		}
		var api = {
			// types: some of 'anime', 'series', 'songs', 'artists' (default all).
			// -> { anime: [{ slug, name, year, season }], series: [{ slug, name }],
			//      songs: [{ id, title, artists: [names], credit, anime: [{ slug, name, year, season, role, seq, themeId }] }],
			//      artists: [{ slug, name }] }
			search: function (q, types, o) {
				var all = ['anime', 'series', 'songs', 'artists'];
				var want = listOf(types).filter(function (t) { return all.indexOf(t) >= 0; });
				if (!want.length) want = all;
				q = str(q).trim();
				var empty = { anime: [], series: [], songs: [], artists: [] };
				if (!q) return Promise.resolve(empty);
				return cache.wrap('at:q:' + want.join(',') + ':' + qkey(q), TTL.atSearch, function () {
					var query = { q: q, 'fields[search]': want.join(',') };
					if (want.indexOf('songs') >= 0) query['include[song]'] = 'artists,animethemes.anime';
					return get('/search', query, o).then(function (j) {
						var s = (j && j.search) || {};
						return {
							anime: listOf(s.anime).map(animeSummary),
							series: listOf(s.series).map(function (x) { return { slug: str(x.slug), name: str(x.name) }; }),
							songs: listOf(s.songs).map(songOf),
							artists: listOf(s.artists).map(function (x) { return { slug: str(x.slug), name: str(x.name) }; })
						};
					});
				}, { signal: o && o.signal }).then(function (r) { return r || empty; });
			},
			// -> { slug, name, year, season, format, series: [slugs], resources: { anilist, mal },
			//      synonyms: [], themes: [find] }, or null when AnimeThemes has no such anime.
			// Kept 14 days while it airs (this season or the last), 180 after.
			anime: function (slug, o) {
				slug = str(slug).trim();
				if (!slug) return Promise.resolve(null);
				return cache.wrap('at:anime:' + slug, function (a) { return airing(a) ? TTL.atAnimeAiring : TTL.atAnime; }, function () {
					return get('/anime/' + encodeURIComponent(slug), { include: 'animethemes.song.artists,series,resources,animesynonyms' }, o).then(function (j) {
						if (!j || !j.anime) throw bad();
						return animeOf(j.anime);
					});
				}, { negTtlMs: DAY, signal: o && o.signal });
			},
			// Every entry of a series (seasons, films), oldest first.
			// -> { slug, name, anime: [{ slug, name, year, season, themes: [find] }] } or null
			series: function (slug, o) {
				slug = str(slug).trim();
				if (!slug) return Promise.resolve(null);
				var path = '/series/' + encodeURIComponent(slug);
				function build(s, list) {
					var ser = { name: str(s.name), slug: str(s.slug) };
					return {
						slug: ser.slug, name: ser.name,
						anime: list.slice().sort(byAired).map(function (a) {
							var out = animeSummary(a);
							out.themes = (a.themes || themesOf(a, ser, null)).map(function (f) { f.series = ser.name; f.seriesKey = 'at:series:' + ser.slug; return f; });
							return out;
						})
					};
				}
				// The real API refuses the nested include, so: the series with its
				// anime, then each anime on its own (each one cached).
				function oneByOne() {
					return get(path, { include: 'anime' }, o).then(function (j) {
						var s = j && j.series;
						if (!s) throw bad();
						return Promise.all(listOf(s.anime).map(function (a) { return api.anime(a.slug, o); })).then(function (full) {
							return build(s, full.filter(Boolean));
						});
					});
				}
				return cache.wrap('at:series:' + slug, TTL.atSeries, function () {
					if (nested === false) return oneByOne();
					return get(path, { include: 'anime.animethemes.song.artists' }, o).then(function (j) {
						var s = j && j.series;
						if (!s) throw bad();
						nested = true;
						return build(s, listOf(s.anime));
					}, function (e) {
						if (isSourceError(e) && e.code === 'bad') { nested = false; return oneByOne(); }
						throw e;
					});
				}, { negTtlMs: DAY, signal: o && o.signal });
			},
			// The anime songs an artist sang, newest first, each with the anime
			// it was first a theme of. -> { slug, name, songs: [find] } or null
			artist: function (slug, o) {
				slug = str(slug).trim();
				if (!slug) return Promise.resolve(null);
				return cache.wrap('at:artist:' + slug, TTL.atArtist, function () {
					return get('/artist/' + encodeURIComponent(slug), { include: 'songs.animethemes.anime,songs.artists' }, o).then(function (j) {
						var a = j && j.artist;
						if (!a) throw bad();
						var songs = [], seen = {};
						listOf(a.songs).forEach(function (s) {
							if (!s || !str(s.title) || seen[s.id]) return;
							seen[s.id] = true;
							var themes = listOf(s.animethemes).filter(function (t) { return t && t.anime; }).sort(function (x, y) { return byAired(x.anime, y.anime); });
							var t = themes[0] || null, an = t ? t.anime : null;
							var artists = listOf(s.artists).length ? s.artists : [{ name: a.name, artistsong: s.artistsong }];
							songs.push(find({
								key: 'at:song:' + s.id, title: s.title, artist: creditOf(artists), people: peopleOf(artists),
								work: an ? an.name : '', workKey: an ? 'at:anime:' + an.slug : '',
								role: t ? ROLES[str(t.type).toUpperCase()] || '' : '', seq: t ? seqOf(t) : 0,
								season: an && an.year ? { year: an.year, season: seasonName(an.season) } : null, year: an ? an.year : 0,
								source: 'animethemes', ids: { at: t ? t.id : null }
							}));
						});
						songs.sort(function (x, y) { return y.year - x.year || (x.title < y.title ? -1 : x.title > y.title ? 1 : 0); });
						return { slug: str(a.slug), name: str(a.name), songs: songs };
					});
				}, { negTtlMs: DAY, signal: o && o.signal });
			},
			// Every anime of a season with its themes, following the pages.
			// season: 'winter' | 'spring' | 'summer' | 'fall'.
			// -> [{ slug, name, year, season, format, resources: { anilist, mal }, themes: [find] }]
			season: function (year, season, o) {
				var y = num(year), s = seasonName(season);
				if (!y || SEASONS.indexOf(s) < 0) return Promise.reject(SourceError('bad', 'That is not an anime season.', { host: 'animethemes' }));
				return cache.wrap('at:season:' + y + ':' + s, TTL.atSeason, function () {
					var out = [], pages = 0;
					function page(path, query) {
						return get(path, query, o).then(function (j) {
							if (!j || !Array.isArray(j.anime)) throw bad();
							j.anime.forEach(function (a) {
								var res = resourcesOf(a.resources), ser = listOf(a.series)[0] || null, e = animeSummary(a);
								e.format = str(a.media_format);
								e.resources = res;
								e.themes = themesOf(a, ser ? { name: str(ser.name), slug: str(ser.slug) } : null, res);
								out.push(e);
							});
							var next = j.links && j.links.next;
							pages++;
							return next && pages < 20 ? page(str(next), null) : out;
						});
					}
					return page('/anime', { 'filter[year]': y, 'filter[season]': s, include: 'animethemes.song.artists,resources', 'page[size]': 100 });
				}, { signal: o && o.signal }).then(function (r) { return r || []; });
			}
		};
		return api;
	}

	// ---- AniList: a season's anime by popularity ------------------------------------------

	var AL_SEASON = 'query ($season: MediaSeason, $year: Int, $perPage: Int) { Page(page: 1, perPage: $perPage) { media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id idMal title { romaji english native } popularity coverImage { medium } format startDate { year month day } } } }';

	function aniList(http, cache) {
		return {
			// -> [{ id, idMal, title: { romaji, english, native }, popularity, cover, format, startDate: { year, month, day } }]
			// o: { perPage (1 to 50, default 50), signal }
			season: function (year, season, o) {
				o = o || {};
				var y = num(year), s = seasonName(season), per = clamp(o.perPage || 50, 1, 50);
				if (!y || SEASONS.indexOf(s) < 0) return Promise.reject(SourceError('bad', 'That is not an anime season.', { host: 'anilist' }));
				return cache.wrap('al:season:' + y + ':' + s + ':' + per, TTL.alSeason, function () {
					return http.post('anilist', '', { query: AL_SEASON, variables: { season: s.toUpperCase(), year: y, perPage: per } }, { signal: o.signal }).then(function (j) {
						var page = j && j.data && j.data.Page;
						if (!page) throw SourceError('bad', 'AniList sent an answer this page cannot read.', { host: 'anilist' });
						return listOf(page.media).map(function (m) {
							var t = m.title || {}, d = m.startDate || {}, cover = str(m.coverImage && m.coverImage.medium);
							return {
								id: m.id, idMal: m.idMal == null ? null : m.idMal,
								title: { romaji: str(t.romaji), english: str(t.english), native: str(t.native) },
								popularity: num(m.popularity), cover: okImage(cover) ? cover : '', format: str(m.format),
								startDate: { year: d.year == null ? null : d.year, month: d.month == null ? null : d.month, day: d.day == null ? null : d.day }
							};
						});
					});
				}, { signal: o.signal }).then(function (r) { return r || []; });
			}
		};
	}

	// ---- iTunes: an artist's albums, EPs and singles, with previews -------------------

	var JAPANESE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF66-\uFF9F]/;
	// The store to ask: o.country, else Japan's for a name in Japanese script, else the US's.
	function countryFor(name, o) { return o && o.country ? str(o.country).toUpperCase() : JAPANESE.test(str(name)) ? 'JP' : 'US'; }
	function artwork(u) { var a = str(u).replace(/\/100x100bb(\.[a-z]+)$/i, '/300x300bb$1'); return okImage(a) ? a : ''; }
	function appleLink(u) { u = str(u).replace(/[?&]uo=\d+$/, ''); return /^https:\/\/music\.apple\.com\/[^\s"'<>\\]*$/.test(u) ? u : ''; }
	function itAlbum(r) {
		var name = str(r.collectionName), m = / - (EP|Single)$/.exec(name), count = num(r.trackCount), type;
		if (str(r.collectionType) === 'Compilation') type = 'Compilation';
		else if (m) type = m[1];
		else if (count > 0 && count <= 3) type = 'Single';
		else type = 'Album';
		return {
			id: r.collectionId, title: m ? name.slice(0, -m[0].length) : name, date: str(r.releaseDate).slice(0, 10), type: type,
			trackCount: count, cover: artwork(r.artworkUrl100), artist: str(r.artistName), genre: str(r.primaryGenreName), link: appleLink(r.collectionViewUrl)
		};
	}
	function itTrack(r) {
		var album = str(r.collectionName).replace(/ - (EP|Single)$/, ''), year = parseInt(str(r.releaseDate).slice(0, 4), 10) || 0;
		return find({
			title: r.trackName, artist: r.artistName, album: album, albumId: r.collectionId != null ? 'it:' + r.collectionId : '',
			year: year, durationSec: Math.round(num(r.trackTimeMillis) / 1000), seq: num(r.trackNumber),
			cover: artwork(r.artworkUrl100), preview: str(r.previewUrl), source: 'itunes', ids: { it: r.trackId }
		});
	}
	function results(j) { return j && Array.isArray(j.results) ? j.results : []; }

	function iTunes(http, cache) {
		function get(path, query, o) { return http.get('itunes', path, { query: query, signal: o && o.signal }); }
		function wrap(key, ttl, fn, o) { return cache.wrap(key, ttl, fn, { signal: o && o.signal }).then(function (r) { return r || []; }); }
		function songs(j) { return results(j).filter(function (r) { return r.wrapperType === 'track' && r.kind === 'song' && r.trackId != null; }); }
		return {
			// -> [{ id, name, genre, link, country }] (country: the store asked)
			searchArtist: function (name, o) {
				var c = countryFor(name, o), term = str(name).trim();
				if (!term) return Promise.resolve([]);
				return wrap('it:q:artist:' + c + ':' + qkey(term), TTL.itSearch, function () {
					return get('/search', { term: term, entity: 'musicArtist', attribute: 'artistTerm', limit: 10, country: c }, o).then(function (j) {
						return results(j).filter(function (r) { return r.wrapperType === 'artist' && r.artistId != null; }).map(function (r) {
							return { id: r.artistId, name: str(r.artistName), genre: str(r.primaryGenreName), link: appleLink(r.artistLinkUrl), country: c };
						});
					});
				}, o);
			},
			// An artist's songs as Apple ranks them. -> [find]. o: { country, name, limit (50) }
			artistSongs: function (id, o) {
				o = o || {};
				var c = countryFor(o.name, o), limit = clamp(o.limit || 50, 1, 200);
				return wrap('it:artist:' + id + ':songs:' + c + ':' + limit, TTL.itArtist, function () {
					return get('/lookup', { id: id, entity: 'song', limit: limit, country: c }, o).then(function (j) { return songs(j).map(itTrack); });
				}, o);
			},
			// Newest first. -> [{ id, title, date, type ('Album' | 'EP' | 'Single' |
			// 'Compilation'), trackCount, cover, artist, genre, link }]. o: { country, name }
			albums: function (id, o) {
				o = o || {};
				var c = countryFor(o.name, o);
				return wrap('it:artist:' + id + ':albums:' + c, TTL.itAlbums, function () {
					return get('/lookup', { id: id, entity: 'album', limit: 200, country: c }, o).then(function (j) {
						var seen = {};
						return results(j).filter(function (r) { if (r.wrapperType !== 'collection' || r.collectionId == null || seen[r.collectionId]) return false; seen[r.collectionId] = true; return true; })
							.map(itAlbum).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
					});
				}, o);
			},
			// An album's songs in order. -> [find]. o: { country, name }
			albumTracks: function (collectionId, o) {
				o = o || {};
				var c = countryFor(o.name, o);
				return wrap('it:album:' + collectionId + ':' + c, TTL.itAlbum, function () {
					return get('/lookup', { id: collectionId, entity: 'song', country: c }, o).then(function (j) {
						return songs(j).sort(function (a, b) { return num(a.discNumber) - num(b.discNumber) || num(a.trackNumber) - num(b.trackNumber); }).map(itTrack);
					});
				}, o);
			},
			// Albums for a query (a work's soundtrack, say), as Apple ranks them.
			// -> albums as above. o: { country, limit (25) }
			searchAlbums: function (term, o) {
				o = o || {};
				var c = countryFor(term, o), limit = clamp(o.limit || 25, 1, 200);
				term = str(term).trim();
				if (!term) return Promise.resolve([]);
				return wrap('it:q:album:' + c + ':' + limit + ':' + qkey(term), TTL.itSearch, function () {
					return get('/search', { term: term, entity: 'album', limit: limit, country: c }, o).then(function (j) {
						return results(j).filter(function (r) { return r.wrapperType === 'collection' && r.collectionId != null; }).map(itAlbum);
					});
				}, o);
			}
		};
	}

	// ---- Last.fm: similar songs and artists (with the listener's own key) -------------

	function lastFm(http, cache, getKey) {
		function key() { try { return str(getKey && getKey()).trim(); } catch (e) { return ''; } }
		function tracks(list) {
			return listOf(list).filter(function (t) { return t && t.name; }).map(function (t) {
				var artist = str(t.artist && (t.artist.name || t.artist['#text'])), d = num(t.duration);
				return find({ title: t.name, artist: artist, durationSec: d > 20000 ? Math.round(d / 1000) : d, source: 'lastfm', score: num(t.match) });
			});
		}
		// The key goes to Last.fm in the query and nowhere else (not in the cache key).
		function call(method, params, ckey, read, o) {
			var k = key();
			if (!k) return Promise.reject(SourceError('auth', 'Add a Last.fm API key in Settings to use Last.fm.', { host: 'lastfm' }));
			return cache.wrap(ckey, TTL.lfm, function () {
				var q = { method: method };
				Object.keys(params).forEach(function (p) { q[p] = params[p]; });
				q.autocorrect = 1;
				q.api_key = k;
				q.format = 'json';
				return http.get('lastfm', '/', { query: q, signal: o && o.signal }).then(read);
			}, { negTtlMs: DAY, signal: o && o.signal }).then(function (r) { return r || []; });
		}
		return {
			available: function () { return !!key(); },
			// -> [find] (score: Last.fm's match, 0 to 1). o: { limit (50) }
			similarTracks: function (artist, title, o) {
				var limit = clamp((o && o.limit) || 50, 1, 250);
				return call('track.getsimilar', { artist: str(artist), track: str(title), limit: limit }, 'lfm:sim:' + fold(artist) + '|' + fold(title) + ':' + limit, function (j) {
					return tracks(j && j.similartracks && j.similartracks.track);
				}, o);
			},
			// -> [{ name, match }]. o: { limit (30) }
			similarArtists: function (name, o) {
				var limit = clamp((o && o.limit) || 30, 1, 250);
				return call('artist.getsimilar', { artist: str(name), limit: limit }, 'lfm:art:' + fold(name) + ':' + limit, function (j) {
					return listOf(j && j.similarartists && j.similarartists.artist).filter(function (a) { return a && a.name; }).map(function (a) { return { name: str(a.name), match: num(a.match) }; });
				}, o);
			},
			// An artist's most played songs. -> [find]. o: { limit (30) }
			topTracks: function (name, o) {
				var limit = clamp((o && o.limit) || 30, 1, 250);
				return call('artist.gettoptracks', { artist: str(name), limit: limit }, 'lfm:top:' + fold(name) + ':' + limit, function (j) {
					return tracks(j && j.toptracks && j.toptracks.track);
				}, o);
			}
		};
	}

	// ---- YouTube lists and searches through the Data API (yt.js's client) -------------

	function ytLists(client, cache) {
		var VIDEO = /^[A-Za-z0-9_-]{11}$/;
		function listTtl(id) { return /^UU/.test(id) ? TTL.listUU : /^RD/.test(id) ? TTL.listRD : TTL.listPL; }
		function vkey(id) { return 'yt:v:' + id; }
		// A list read page by page (1 unit per 50) until max, kept with where
		// it stopped, so a longer read later goes on from there.
		function readList(listId, max, source, channelId, o) {
			o = o || {};
			max = clamp(max, 1, 5000);
			var key = 'yt:list:' + listId;
			return withSignal(cache.get(key), o.signal).then(function (have) {
				if (have && have.items && (have.items.length >= max || !have.next)) return have.items.slice(0, max);
				var items = [], token = null, total = null, seen = {}, resumed = false;
				if (have && have.items) { items = have.items.slice(); token = have.next; total = have.total; resumed = true; }
				items.forEach(function (f) { seen[f.videoId] = true; });
				function page() {
					return client.playlistPage(listId, token, { signal: o.signal }).then(function (pg) {
						pg.items.forEach(function (it) {
							if (it.unavailable || !it.videoId || seen[it.videoId]) return;
							seen[it.videoId] = true;
							items.push(find({ videoId: it.videoId, title: it.title, channel: it.channel || '', channelId: channelId || it.channelId || '', source: source, addedAt: it.addedAt || null }));
						});
						token = pg.nextPageToken;
						if (pg.total != null) total = pg.total;
						return token && items.length < max ? page() : null;
					}, function (e) {
						// a saved page token YouTube no longer takes: read again from the top
						if (resumed && e && e.code === 'bad-request') { resumed = false; items = []; seen = {}; token = null; return page(); }
						throw e;
					});
				}
				return page().then(function () {
					return cache.put(key, { items: items, next: token || null, total: total }, listTtl(listId)).then(function () { return items.slice(0, max); });
				});
			});
		}
		function searchKey(kind, q) { return 'yt:q:' + kind + ':' + qkey(q); }
		// One search, kept 30 days with the number asked for: a later search
		// for fewer is answered from it, one for more asks again.
		function search(key, max, run, o) {
			return withSignal(cache.get(key), o && o.signal).then(function (have) {
				if (have && have.max >= max) return have.items.slice(0, max);
				return run().then(function (items) {
					return cache.put(key, { max: max, items: items }, TTL.ytRes).then(function () { return items; });
				});
			});
		}
		return {
			// A channel's uploads, newest first. -> [find] (source 'ytuploads', addedAt). o: { max (100), signal }
			uploads: function (channelId, o) {
				o = o || {};
				var id = str(channelId);
				if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) return Promise.reject(SourceError('bad', 'That is not a YouTube channel id.', { host: 'youtube' }));
				return readList('UU' + id.slice(2), o.max == null ? 100 : o.max, 'ytuploads', id, o);
			},
			// Any list (PL..., OLAK5uy_... albums). -> [find] (source 'ytplaylist'). o: { max (200), signal }
			playlist: function (id, o) {
				o = o || {};
				id = str(id);
				if (!/^[A-Za-z0-9_-]{2,}$/.test(id)) return Promise.reject(SourceError('bad', 'That is not a YouTube list id.', { host: 'youtube' }));
				return readList(id, o.max == null ? 200 : o.max, 'ytplaylist', '', o);
			},
			// Details of any number of videos (videoBatch, 1 unit per 50), each
			// kept 30 days, a missing one 7. -> { videos: [library records], missing: [ids] }
			videos: function (ids, o) {
				o = o || {};
				var all = uniq(listOf(ids).map(str)), ok = all.filter(function (id) { return VIDEO.test(id); });
				return cache.getMany(ok.map(vkey)).then(function (have) {
					var got = {}, need = [];
					ok.forEach(function (id) { var v = have[vkey(id)]; if (v === undefined) need.push(id); else got[id] = v; });
					var batches = chunks(need, 50);
					function next(i) {
						if (i >= batches.length) return Promise.resolve();
						return client.videoBatch(batches[i], { signal: o.signal }).then(function (r) {
							var puts = [];
							r.videos.forEach(function (v) { got[v.id] = v; puts.push(cache.put(vkey(v.id), v, TTL.ytRes)); });
							r.missing.forEach(function (id) { got[id] = null; puts.push(cache.put(vkey(id), null, TTL.ytResNo)); });
							return Promise.all(puts).then(function () { return next(i + 1); });
						});
					}
					return next(0).then(function () {
						var videos = [], missing = [];
						all.forEach(function (id) { if (got[id]) videos.push(got[id]); else missing.push(id); });
						return { videos: videos, missing: missing };
					});
				});
			},
			// client.search (100 units), kept 30 days. o: { max (5), category ('10'; null: every category), signal }
			searchVideos: function (q, o) {
				o = o || {};
				var category = o.category === undefined ? '10' : o.category == null ? '' : str(o.category), max = clamp(o.max || 5, 1, 25);
				var kind = 'video' + (category === '10' ? '' : '-' + (category || 'any'));
				return search(searchKey(kind, q), max, function () { return client.search(q, { max: max, category: category || null, signal: o.signal }); }, o);
			},
			// client.searchPlaylists (100 units), kept 30 days. o: { max (10), signal }
			searchPlaylists: function (q, o) {
				o = o || {};
				var max = clamp(o.max || 10, 1, 25);
				return search(searchKey('playlist', q), max, function () { return client.searchPlaylists(q, { max: max, signal: o.signal }); }, o);
			}
		};
	}

	// ---- Deezer (discover.js) as finds, with a lasting cache in front ----------------------

	var DZ_TYPES = { album: 'Album', single: 'Single', ep: 'EP', compile: 'Compilation' };

	function deezerFinds(dz, cache) {
		function dzFind(t, album) {
			return find({
				title: t.title, version: t.version, artist: t.artist, album: t.album || (album && album.title) || '',
				albumId: album && album.id != null ? 'dz:' + album.id : '', durationSec: t.duration,
				cover: t.cover || (album && album.cover) || '', preview: t.preview, source: 'deezer', ids: { dz: t.id }
			});
		}
		function dzArtist(a) { var pic = str(a.picture_medium); return { id: a.id, name: str(a.name), picture: okImage(pic) ? pic : '', fans: num(a.nb_fan) }; }
		function dzAlbum(a) { return { id: a.id, title: str(a.title), date: str(a.date), type: DZ_TYPES[str(a.type)] || 'Album', trackCount: num(a.trackCount), cover: okImage(a.cover) ? a.cover : '', artist: '', genre: '', fans: num(a.fans) }; }
		// 'dz:' + the Deezer path, the same one discover.js caches in memory.
		function kept(path, ask, read) {
			return cache.wrap('dz:' + path, TTL.dz, function () {
				return Promise.resolve().then(ask).then(read, function (e) {
					if (isSourceError(e)) throw e;
					throw SourceError('network', 'Deezer did not answer. Try again in a moment.', { host: 'deezer', detail: e && e.message });
				});
			}).then(function (r) { return r || []; });
		}
		return {
			// -> [{ id, name, picture, fans }]
			related: function (id) { return kept('artist/' + id + '/related?limit=20', function () { return dz.related(id); }, function (l) { return listOf(l).map(dzArtist); }); },
			// -> [find]
			top: function (id, n) {
				n = n || 5;
				return kept('artist/' + id + '/top?limit=' + n, function () { return dz.top(id, n); }, function (l) { return listOf(l).map(function (t) { return dzFind(DX.trackOf(t)); }); });
			},
			// Newest first. -> [{ id, title, date, type, trackCount, cover, artist, genre, fans }]
			albums: function (id) { return kept('artist/' + id + '/albums?limit=50', function () { return dz.albums(id); }, function (l) { return listOf(l).map(dzAlbum); }); },
			// album: { id, title, cover } (one of albums()). -> [find]
			albumTracks: function (album) {
				return kept('album/' + album.id + '/tracks?limit=60', function () { return dz.albumTracks(album); }, function (l) { return listOf(l).map(function (t) { return dzFind(t, album); }); });
			},
			// An artist mix. -> [find]
			radio: function (id, n) {
				n = n || 40;
				return kept('artist/' + id + '/radio?limit=' + n, function () { return dz.radio(id, n); }, function (l) { return listOf(l).map(function (t) { return dzFind(t); }); });
			},
			// -> [{ id, name, picture, fans }]
			searchArtists: function (name) {
				return kept('search/artist?q=' + encodeURIComponent(str(name)) + '&limit=6', function () { return dz.searchArtists(name); }, function (l) { return listOf(l).map(dzArtist); });
			}
		};
	}

	return {
		HOSTS: HOSTS, TTL: TTL,
		SourceError: SourceError, isSourceError: isSourceError,
		endpointsFor: endpointsFor, createHttp: createHttp, createCache: createCache,
		find: find, okImage: okImage, okPreview: okPreview, seasonAt: seasonAt,
		oEmbed: oEmbed, animeThemes: animeThemes, aniList: aniList, iTunes: iTunes, lastFm: lastFm, ytLists: ytLists, deezerFinds: deezerFinds
	};
});
