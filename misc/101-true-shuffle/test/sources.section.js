/*
 * sources.js: the network layer (per-source lines on a fake clock: gaps,
 * places, Retry-After, backoff, the breaker, offline, shared requests,
 * abort), the find, the allowlists, and every client against the invented
 * answers in test/fixtures (in-process through createSourceFake().fetch,
 * and over HTTP through the fake for yt.js's searches and ytLists).
 * Loaded by test.js, which runs it as the section "sources".
 */
'use strict';
var path = require('path');
var url = require('url');

module.exports = function (h) {
	var DAY = 86400000, T = 1000000;
	var HIKARI = String.fromCharCode(0x3072, 0x304B, 0x308A, 0x306E, 0x5730, 0x56F3);

	// A clock that moves only when told; sleep() waits on it.
	function fakeClock(start) {
		var t = start, timers = [], seq = 0;
		return {
			now: function () { return t; },
			sleep: function (ms) { return new Promise(function (resolve) { timers.push({ at: t + Math.max(0, ms || 0), resolve: resolve, n: seq++ }); }); },
			advance: async function (ms) {
				var end = t + ms;
				for (;;) {
					await settle();
					timers.sort(function (a, b) { return a.at - b.at || a.n - b.n; });
					if (!timers.length || timers[0].at > end) break;
					var next = timers.shift();
					if (next.at > t) t = next.at;
					next.resolve();
				}
				t = end;
				await settle();
			}
		};
	}
	async function settle() { for (var i = 0; i < 12; i++) await h.tickAll(); }
	function response(status, body, headers) {
		var text = typeof body === 'string' ? body : JSON.stringify(body), hs = {};
		Object.keys(headers || {}).forEach(function (k) { hs[k.toLowerCase()] = headers[k]; });
		return { ok: status >= 200 && status < 300, status: status, headers: { get: function (n) { var v = hs[String(n).toLowerCase()]; return v == null ? null : v; } }, text: function () { return Promise.resolve(text); } };
	}
	// A fetch that answers what answer(call) says: { status, body, headers, delay, network }.
	function scripted(clock, answer) {
		var calls = [], open = 0;
		function f(u, init) {
			var call = { url: u, init: init, at: clock.now(), n: calls.length };
			calls.push(call);
			open++;
			if (open > f.max) f.max = open;
			var a = answer(call) || {};
			return new Promise(function (resolve, reject) {
				function go() {
					open--;
					if (init && init.signal && init.signal.aborted) { var e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); return; }
					if (a.network) { reject(new TypeError('Failed to fetch')); return; }
					resolve(response(a.status || 200, a.body === undefined ? { ok: true, n: call.n } : a.body, a.headers));
				}
				if (a.delay) clock.sleep(a.delay).then(go); else go();
			});
		}
		f.calls = calls;
		f.max = 0;
		return f;
	}
	function caught(p) { return p.then(null, function (e) { return e; }); }

	h.describe('sources', async function () {
		var S = require(path.join(h.HERE, 'sources.js'));
		var Store = require(path.join(h.HERE, 'store.js'));
		var Y = require(path.join(h.HERE, 'yt.js'));
		var L = require(path.join(h.HERE, 'library.js'));
		var D = require(path.join(h.HERE, 'discover.js'));
		var i;

		function rig(answer, o) {
			o = o || {};
			var clock = fakeClock(T), f = scripted(clock, answer);
			var http = S.createHttp({ fetch: f, now: clock.now, sleep: clock.sleep, onLine: o.onLine || function () { return true; }, hosts: o.hosts });
			return { clock: clock, fetch: f, http: http, starts: function () { return f.calls.map(function (c) { return c.at - T; }); } };
		}

		// ---- the lines: gaps and places
		var a = rig(function () { return {}; });
		var ap = ['/a', '/b', '/c'].map(function (p) { return a.http.get('animethemes', p); });
		await a.clock.advance(5000);
		var ar = await Promise.all(ap);
		h.eq([a.starts(), ar.map(function (r) { return r.n; })], [[0, 700, 1400], [0, 1, 2]], 'AnimeThemes: one request at a time, 700 ms between starts, each caller with its own answer');
		h.eq(a.fetch.calls.map(function (c) { return c.url; }), ['https://api.animethemes.moe/a', 'https://api.animethemes.moe/b', 'https://api.animethemes.moe/c'], 'the address is the source\'s base and the path');
		var b = rig(function () { return { delay: 1000 }; });
		var bp = [1, 2, 3].map(function (n) { return b.http.get('lastfm', '/', { query: { n: n } }); });
		await b.clock.advance(5000);
		await Promise.all(bp);
		h.eq([b.starts(), b.fetch.max, b.fetch.calls[0].url], [[0, 250, 1000], 2, 'https://ws.audioscrobbler.com/2.0/?n=1'], 'Last.fm: 250 ms apart and two at once; the third waits for a free place');
		var c = rig(function () { return { delay: 1000, body: {} }; });
		var cp = [1, 2, 3, 4, 5].map(function (n) { return c.http.get('oembed', '/oembed', { query: { n: n } }); });
		await c.clock.advance(5000);
		await Promise.all(cp);
		h.eq([c.starts(), c.fetch.max], [[0, 150, 300, 1000, 1150], 3], 'oEmbed: 150 ms apart, three at once');

		// ---- waiting when asked, trying again
		var d = rig(function (call) { return call.n === 0 ? { status: 429, headers: { 'Retry-After': '5' }, body: { message: 'Too Many Attempts.' } } : {}; });
		var d1 = d.http.get('animethemes', '/x'), d2 = d.http.get('animethemes', '/y');
		await d.clock.advance(10000);
		h.eq([(await d1).n, (await d2).n, d.starts()], [1, 2, [0, 5000, 5700]], '429 with Retry-After: 5: the whole line waits five seconds, the request goes again, then the next one');
		var e = rig(function (call) { return call.n < 2 ? { status: 429 } : {}; });
		var e1 = e.http.get('animethemes', '/x');
		await e.clock.advance(10000);
		h.eq([(await e1).n, e.starts()], [2, [0, 1000, 3000]], '429 without Retry-After: waits 1 s, then 2 s');
		var f = rig(function (call) { return call.n < 3 ? { status: 503, body: 'Service Unavailable' } : {}; });
		var f1 = caught(f.http.get('animethemes', '/x'));
		await f.clock.advance(10000);
		var fe = await f1;
		h.eq([fe.code, fe.status, fe.host, S.isSourceError(fe), f.starts()], ['server', 503, 'animethemes', true, [0, 1000, 3000]], '5xx: tried again after 1 s and 2 s (three tries for AnimeThemes), then a typed error');
		h.eq(fe.message, 'AnimeThemes is having trouble answering. Try again later.', 'the message is a sentence that names the source');
		h.eq(f.http.stats().animethemes, { sent: 3, failed: 3, queued: 0, active: 0, down: true }, 'three failures in a row: the line is closed (stats)');
		var f2 = await caught(f.http.get('animethemes', '/y'));
		h.eq([f2.code, f2.message, f.fetch.calls.length], ['down', 'AnimeThemes is not answering; trying again in a minute.', 3], 'while it is closed a request fails at once, and nothing is sent');
		await f.clock.advance(60000);
		var f3 = f.http.get('animethemes', '/z');
		await f.clock.advance(0);
		h.eq([(await f3).n, f.http.stats().animethemes.down], [3, false], 'a minute later the line is open again');
		var g = rig(function () { return { network: true }; });
		var g1 = caught(g.http.get('anilist', '/'));
		await g.clock.advance(5000);
		var ge = await g1;
		h.eq([ge.code, g.starts(), ge.message], ['network', [0, 1000], 'AniList could not be reached. Check the connection and try again.'], 'no answer at all: tried again after 1 s (AniList has two tries), then "network"');
		var hh = rig(function (call) { return /missing/.test(call.url) ? { status: 404, body: { message: 'Not Found' } } : { status: 422, body: { message: 'The selected include is invalid.' } }; });
		var h404 = caught(hh.http.get('animethemes', '/anime/missing'));
		await hh.clock.advance(3000);
		h.eq([(await h404).code, (await h404).status, hh.fetch.calls.length], ['not-found', 404, 1], '404: not-found, and not tried again');
		var h422 = caught(hh.http.get('animethemes', '/series/x', { query: { include: 'anime.animethemes' } }));
		await hh.clock.advance(3000);
		h.eq([(await h422).code, (await h422).body.message, hh.fetch.calls.length], ['bad', 'The selected include is invalid.', 2], '422: bad, with the answer on the error, not tried again');

		// ---- iTunes's pause and Last.fm's errors in the body
		var m = rig(function (call) { return call.n === 0 ? { status: 403, body: '' } : {}; });
		var m1 = m.http.get('itunes', '/search', { query: { term: 'x' } }), m2 = m.http.get('itunes', '/lookup', { query: { id: 1 } });
		await m.clock.advance(70000);
		h.eq([(await m1).n, (await m2).n, m.starts()], [1, 2, [0, 60000, 63100]], 'iTunes: a 403 (Apple asking for fewer) holds the whole line a minute, then the request goes again, then the next 3.1 s later');
		var m3 = rig(function () { return { status: 403 }; });
		var m3e = caught(m3.http.get('itunes', '/search'));
		await m3.clock.advance(70000);
		h.eq([(await m3e).code, m3.starts(), (await m3e).message], ['rate', [0, 60000], 'iTunes asked for fewer requests. Try again in a minute.'], 'iTunes: refused twice: "rate"');
		var n = rig(function (call) { return call.n === 0 ? { body: { error: 29, message: 'Rate Limit Exceeded' } } : call.n === 1 ? {} : { status: 403, body: { error: 10, message: 'Invalid API key' } }; });
		var n1 = n.http.get('lastfm', '/', { query: { method: 'artist.getsimilar' } });
		await n.clock.advance(40000);
		h.eq([(await n1).n, n.starts()], [1, [0, 30000]], 'Last.fm error 29 (inside an answer that is otherwise 200): waits 30 s, then asks again');
		var n2 = caught(n.http.get('lastfm', '/', { query: { method: 'track.getsimilar' } }));
		await n.clock.advance(1000);
		var ne = await n2;
		h.eq([ne.code, ne.message, n.fetch.calls.length], ['auth', 'Last.fm did not accept the API key. Check it in Settings.', 3], 'Last.fm error 10: "auth", with a sentence that points at Settings, not tried again');

		// ---- offline
		var online = true, o = rig(function () { return {}; }, { onLine: function () { return online; } });
		online = false;
		var o1 = await caught(o.http.get('itunes', '/search'));
		h.eq([o1.code, o1.message, o.fetch.calls.length], ['offline', 'This device is offline, so iTunes cannot be asked.', 0], 'offline: fails at once, with nothing sent');
		online = true;
		var o2 = o.http.get('itunes', '/a'), o3 = caught(o.http.get('itunes', '/b'));
		online = false;
		await o.clock.advance(4000);
		h.eq([(await o2).n, (await o3).code, o.fetch.calls.length], [0, 'offline', 1], 'a request still in line when the device goes offline fails when its turn comes');

		// ---- shared requests, abort, what is sent
		var j = rig(function () { return { delay: 100 }; });
		var j1 = j.http.get('itunes', '/lookup', { query: { id: 5 } }), j2 = j.http.get('itunes', '/lookup', { query: { id: 5 } }), j3 = j.http.get('itunes', '/lookup', { query: { id: 6 } });
		await j.clock.advance(10000);
		var jr = await Promise.all([j1, j2, j3]);
		h.eq([j.fetch.calls.length, jr[0] === jr[1], jr[0].n, jr[2].n], [2, true, 0, 1], 'identical requests in flight share one answer; another query is a request of its own');
		var jp = [j.http.post('anilist', '', { query: 'q', variables: { a: 1 } }), j.http.post('anilist', '', { query: 'q', variables: { a: 1 } }), j.http.post('anilist', '', { query: 'q', variables: { a: 2 } })];
		await j.clock.advance(10000);
		await Promise.all(jp);
		h.eq(j.fetch.calls.length, 4, 'a POST with the same body shares too; another body does not');
		var init = j.fetch.calls[0].init, pinit = j.fetch.calls[2].init;
		h.eq([init.method, init.credentials, init.referrerPolicy, Object.keys(init.headers), init.headers.Accept, 'body' in init], ['GET', 'omit', 'no-referrer', ['Accept'], 'application/json', false], 'every request: no cookies, no referrer, and no header but Accept');
		h.eq([pinit.method, pinit.headers['Content-Type'], JSON.parse(pinit.body), pinit.credentials, j.fetch.calls[2].url], ['POST', 'application/json', { query: 'q', variables: { a: 1 } }, 'omit', 'https://graphql.anilist.co'], 'a POST sends its body as JSON, without cookies either');
		var k = rig(function () { return {}; });
		var ac = new AbortController();
		var k1 = k.http.get('animethemes', '/a'), k2 = caught(k.http.get('animethemes', '/b', { signal: ac.signal }));
		await k.clock.advance(100);
		ac.abort();
		await k.clock.advance(5000);
		h.eq([(await k1).n, (await k2).code, k.fetch.calls.map(function (x) { return x.url; })], [0, 'aborted', ['https://api.animethemes.moe/a']], 'a signal that fires while the request waits in line takes it out: never sent, and the caller is told "aborted"');
		var ac2 = new AbortController();
		k.http.get('animethemes', '/c');
		var k4 = caught(k.http.get('animethemes', '/d', { signal: ac2.signal })), k5 = k.http.get('animethemes', '/d');
		await k.clock.advance(100);
		ac2.abort();
		await k.clock.advance(5000);
		h.eq([(await k4).code, (await k5).n, k.fetch.calls.length], ['aborted', 2, 3], 'two callers share a request and one gives up: the other still gets the answer, from one request');
		var ac3 = new AbortController();
		ac3.abort();
		var k6 = await caught(k.http.get('animethemes', '/e', { signal: ac3.signal }));
		h.eq([k6.code, k.fetch.calls.length], ['aborted', 3], 'a signal that has already fired: nothing is sent');

		// ---- other addresses
		var p = rig(function () { return {}; });
		var p1 = p.http.get('https://example.test/api/', '/x', { query: { a: 'b c', none: null, empty: '' } });
		var p2 = p.http.get('animethemes', 'https://api.animethemes.moe/anime?page%5Bnumber%5D=2');
		var p3 = await caught(p.http.get('animethemes', 'https://evil.example/anime'));
		var p4 = await caught(p.http.get('nosuch', '/x'));
		await p.clock.advance(1000);
		await Promise.all([p1, p2]);
		h.eq(p.fetch.calls.map(function (x) { return x.url; }), ['https://example.test/api/x?a=b%20c', 'https://api.animethemes.moe/anime?page%5Bnumber%5D=2'], 'a base address of its own works too (empty values left out); a next-page link on the source\'s own base is followed');
		h.eq([p3.code, p4.code], ['bad', 'bad'], 'an address on another site, or a source that does not exist, is refused before anything is sent');
		h.ok('https://example.test/api' in p.http.stats() && 'vndb' in p.http.stats(), 'stats: every source, and the extra base');

		// ---- where to talk to
		var fakeEp = Y.endpoints({ search: '?api=http://127.0.0.1:9999', hostname: 'localhost', storage: null });
		var hs = S.endpointsFor(fakeEp);
		h.eq(['animethemes', 'anilist', 'itunes', 'lastfm', 'oembed', 'vndb'].map(function (x) { return hs[x].base; }), ['http://127.0.0.1:9999/animethemes', 'http://127.0.0.1:9999/anilist', 'http://127.0.0.1:9999/itunes', 'http://127.0.0.1:9999/lastfm', 'http://127.0.0.1:9999', 'http://127.0.0.1:9999/vndb'], 'endpointsFor: with the local fake (?api= on localhost) every source goes to it; oEmbed keeps its /oembed path');
		h.eq(S.endpointsFor({ test: true, api: 'http://127.0.0.1:9999/youtube/v3' }).itunes.base, 'http://127.0.0.1:9999/itunes', 'endpointsFor: the fake\'s base from its api address when there is no base');
		var real = S.endpointsFor(Y.endpoints({ search: '?api=http://127.0.0.1:9999', hostname: 'nietztein.github.io', storage: null }));
		h.eq(Object.keys(real).map(function (x) { return real[x].base; }), ['https://api.animethemes.moe', 'https://graphql.anilist.co', 'https://itunes.apple.com', 'https://ws.audioscrobbler.com/2.0', 'https://www.youtube.com', 'https://api.vndb.org/kana'], 'endpointsFor: the real addresses on the real site');
		real.animethemes.gap = 1;
		h.eq(Object.keys(S.HOSTS).map(function (x) { return [S.HOSTS[x].gap, S.HOSTS[x].at, S.HOSTS[x].tries]; }), [[700, 1, 3], [1000, 1, 2], [3100, 1, 2], [250, 2, 2], [150, 3, 1], [1500, 1, 2]], 'HOSTS: gaps, places and tries per source (endpointsFor hands out copies)');
		h.eq([S.HOSTS.itunes.pauseOn, S.HOSTS.itunes.pauseMs], [[403, 429], 60000], 'HOSTS: iTunes pauses a minute on 403 and 429');
		h.eq(['oembed', 'oembedNo', 'ytRes', 'ytResNo', 'listRD', 'listPL', 'atSearch', 'atAnimeAiring', 'atAnime', 'atSeries', 'atArtist', 'atSeason', 'atTrack', 'alSeason', 'itSearch', 'itArtist', 'itAlbums', 'itAlbum', 'lfm', 'dz'].map(function (x) { return S.TTL[x] / DAY; }).concat([S.TTL.listUU / 3600000]), [30, 7, 30, 7, 2, 7, 7, 14, 180, 30, 30, 1, 90, 1, 30, 7, 3, 90, 14, 7, 6], 'TTL: how long each kind of answer is kept');

		// ---- the find and the allowlists
		var blank = S.find({});
		h.eq(Object.keys(blank), ['key', 'videoId', 'title', 'titleAlt', 'artist', 'artistNative', 'people', 'album', 'albumId', 'work', 'workKey', 'series', 'seriesKey', 'role', 'seq', 'season', 'year', 'durationSec', 'version', 'cover', 'preview', 'channel', 'channelId', 'source', 'ids', 'why', 'score', 'at'], 'find: every field of the shape');
		h.eq([blank.key, blank.videoId, blank.people, blank.season, blank.ids, blank.why, blank.score, blank.title], ['', null, [], null, {}, [], 0, ''], 'find: the defaults');
		var lf1 = S.find({ title: 'Blue Signal', artist: 'The Paper Lanterns', source: 'lastfm', durationSec: '241', seq: 'x', ids: { lfm: '', it: null }, season: { year: '2019', season: 'Spring' } });
		h.eq([lf1.key, lf1.durationSec, lf1.seq, lf1.ids, lf1.season], ['lfm:paperlanterns|bluesignal', 241, 0, {}, { year: 2019, season: 'spring' }], 'find: numbers are numbers, empty ids are dropped, a Last.fm find is keyed by its folded artist and title');
		h.eq([S.find({ ids: { at: 91001 }, source: 'animethemes' }).key, S.find({ ids: { it: 5 } }).key, S.find({ ids: { dz: 7 }, source: 'deezer' }).key, S.find({ videoId: 'abcdefghijk', title: 'x' }).key, S.find({ key: 'at:song:1', videoId: 'abcdefghijk' }).key, S.find({ title: 'Only A Title' }).key],
			['at:song:91001', 'it:track:5', 'dz:track:7', 'v:abcdefghijk', 'at:song:1', 'lfm:|onlyatitle'], 'find: the key forms (at:song, it:track, dz:track, v:<video> when only a video is known), a key given is kept');
		h.eq([S.find({ title: 'x', addedAt: '2020-01-01' }).addedAt, S.find({ cover: 'https://evil.example/x.jpg', preview: 'https://cdnt-preview.dzcdn.net/x.mp3' }).cover, S.find({ preview: 'http://audio-ssl.itunes.apple.com/x.m4a' }).preview], ['2020-01-01', '', ''], 'find: a field outside the shape is kept; a cover or preview from a host not allowed is dropped');
		var goodImg = ['https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg', 'https://is5-ssl.mzstatic.com/x', 'https://s4.anilist.co/file/anilistcdn/x.jpg', 'https://i.ytimg.com/vi/x/hqdefault.jpg', 'https://e-cdns-images.dzcdn.net/images/x.jpg', 'https://cdn-images.dzcdn.net/images/x.jpg'];
		var badImg = ['http://is1-ssl.mzstatic.com/x', 'https://is1-ssl.mzstatic.com.evil.example/x', 'https://evil.example/https://s4.anilist.co/x', 'https://s4.anilist.co', 'https://i.ytimg.com/x"onerror="y', 'https://img.youtube.com/vi/x/0.jpg', 'https://cdnt-preview.dzcdn.net/x.jpg', '', null, 5];
		h.eq([goodImg.map(S.okImage), badImg.map(S.okImage)], [goodImg.map(function () { return true; }), badImg.map(function () { return false; })], 'okImage: Apple\'s, AniList\'s, YouTube\'s and Deezer\'s picture hosts only, on https');
		var goodPv = ['https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a', 'https://cdnt-preview.dzcdn.net/api/1/1/x.mp3?hdnea=exp=1', 'https://cdns-preview-d.dzcdn.net/stream/x.mp3'];
		var badPv = ['https://audio.itunes.apple.com/x', 'http://audio-ssl.itunes.apple.com/x', 'https://cdns-preview-.dzcdn.net/x', 'https://evil.example/cdnt-preview.dzcdn.net/x', 'https://i.ytimg.com/x.mp3', 'https://cdnt-preview.dzcdn.net/x y.mp3'];
		h.eq([goodPv.map(S.okPreview), badPv.map(S.okPreview)], [goodPv.map(function () { return true; }), badPv.map(function () { return false; })], 'okPreview: Apple\'s and Deezer\'s preview hosts only');
		h.eq([S.seasonAt(Date.UTC(2026, 9, 10)), S.seasonAt(Date.UTC(2026, 0, 1)), S.seasonAt(Date.UTC(2026, 3, 1)), S.seasonAt(Date.UTC(2026, 8, 30, 23))], [{ year: 2026, season: 'fall' }, { year: 2026, season: 'winter' }, { year: 2026, season: 'spring' }, { year: 2026, season: 'summer' }], 'seasonAt: the anime season of a moment');
		h.eq([S.isSourceError(S.SourceError('rate', 'x')), S.isSourceError(new Error('x')), S.SourceError('down', 'm', { host: 'h', status: 1 }).host], [true, false, 'h'], 'SourceError, isSourceError');

		// ---- the clients, against the fixtures (in-process)
		var mod = await import(url.pathToFileURL(path.join(h.HERE, 'test', 'fake-youtube.mjs')).href);
		var sf = mod.createSourceFake(), asked = [];
		var hosts = S.endpointsFor({ test: true, base: 'http://fixtures.test' });
		Object.keys(hosts).forEach(function (x) { hosts[x].gap = 0; });
		var http = S.createHttp({ hosts: hosts, onLine: function () { return true; }, fetch: function (u, init) { asked.push({ url: u, init: init }); return sf.fetch(u, init); } });
		var clock = Date.UTC(2026, 9, 10, 12), now = function () { return clock; };
		var store = Store.memory(), cache = S.createCache({ store: store, now: now });
		function lastUrl() { return new URL(asked[asked.length - 1].url); }
		function ttls(prefix) { return store.cacheRange(prefix, { now: clock }).then(function (rows) { var out = {}; rows.forEach(function (r) { out[r.key] = (r.exp - clock) / DAY; }); return out; }); }

		// oEmbed
		var oe = S.oEmbed(http, cache);
		h.eq(await oe.video('fakeS000001'), { id: 'fakeS000001', title: 'Harbor of Small Lights', channel: 'Aoi Minato - Topic', channelId: 'UCfakeTopicAoiMinato0001', ok: true }, 'oEmbed: a video\'s title and channel, and the channel id when the author is a /channel/UC... address');
		h.eq(asked[asked.length - 1].url, 'http://fixtures.test/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DfakeS000001&format=json', 'oEmbed: the address asked');
		var v2 = await oe.video('fake0000002');
		h.eq([v2.channel, v2.handle, 'channelId' in v2], ['Red Hollow Sessions', '@RedHollowSessions', false], 'oEmbed: an /@handle author gives the handle');
		h.eq(await oe.video('fake0000037'), { id: 'fake0000037', ok: false, reason: 'not-embeddable' }, 'oEmbed: 401, the owner does not allow embedding');
		h.eq(await oe.video('fake0000041'), { id: 'fake0000041', ok: false, reason: 'not-found' }, 'oEmbed: 404, a deleted video');
		var before = asked.length;
		h.eq([(await oe.video('not an id')).reason, (await oe.video('fakeS000001')).title, asked.length - before], ['not-found', 'Harbor of Small Lights', 0], 'oEmbed: a malformed id is not sent, and an answer comes from the cache the second time');
		var oeT = await ttls('oe:');
		h.eq([oeT['oe:fakeS000001'], oeT['oe:fake0000037'], oeT['oe:fake0000041']], [30, 7, 7], 'oEmbed: an answer is kept 30 days, a "no" 7');
		var many = await oe.videos(['fake0000006', 'fakeS000005', 'fake0000097', 'fake0000012', 'fake0000018', 'fakeS000004']);
		h.eq(many.map(function (r) { return r.id + ' ' + (r.ok ? 'ok' : r.reason); }), ['fake0000006 ok', 'fakeS000005 ok', 'fake0000097 not-embeddable', 'fake0000012 ok', 'fake0000018 ok', 'fakeS000004 not-embeddable'], 'oEmbed videos: every answer, in the order asked (a private video is not embeddable either)');
		var four = rig(function () { return { delay: 100, body: { title: 't', author_name: 'a', author_url: 'https://www.youtube.com/@a' } }; }, { hosts: { oembed: { base: 'https://www.youtube.com', gap: 0, at: 10, tries: 1, name: 'YouTube' } } });
		var ten = [];
		for (i = 1; i <= 10; i++) ten.push('fake00000' + (i < 10 ? '0' + i : i));
		var tenP = S.oEmbed(four.http, S.createCache({ now: four.clock.now })).videos(ten);
		await four.clock.advance(1000);
		h.eq([(await tenP).length, four.fetch.max, four.starts()], [10, 4, [0, 0, 0, 0, 100, 100, 100, 100, 200, 200]], 'oEmbed videos: four at a time');

		// AnimeThemes
		var at = S.animeThemes(http, cache);
		var sr = await at.search('Lumen');
		var su = lastUrl();
		h.eq([su.pathname, su.searchParams.get('q'), su.searchParams.get('fields[search]'), su.searchParams.get('include[song]')], ['/animethemes/search', 'Lumen', 'anime,series,songs,artists', 'artists,animethemes.anime'], 'AnimeThemes search: the address');
		h.eq(sr.anime, [{ slug: 'lumen_tide', name: 'Lumen Tide', year: 2019, season: 'spring' }, { slug: 'lumen_tide_2nd_season', name: 'Lumen Tide 2nd Season', year: 2021, season: 'fall' }, { slug: 'lumen_tide_the_far_shore', name: 'Lumen Tide: The Far Shore', year: 2023, season: 'summer' }], 'search: the anime, seasons in lower case');
		h.eq([sr.series, sr.songs, sr.artists], [[{ slug: 'lumen_tide', name: 'Lumen Tide' }], [], []], 'search: the series; no song or artist of that name');
		var ss = await at.search('paper moon', ['songs']);
		h.eq(ss.songs[0], { id: 92002, title: 'Paper Moon Letter', artists: ['Shiori Kanda', 'Rena Ogura'], credit: 'Mio Asahina (CV: Shiori Kanda) & Kaede Tsukishima (CV: Rena Ogura)', anime: [{ slug: 'lumen_tide', name: 'Lumen Tide', year: 2019, season: 'spring', role: 'ED', seq: 1, themeId: 91002 }] }, 'search for songs: each with its singers, its credit and the anime it is a theme of');
		h.eq([ss.songs.length, ss.anime, lastUrl().searchParams.get('fields[search]')], [2, [], 'songs'], 'search: only the kinds asked for');
		var lt = await at.anime('lumen_tide');
		h.eq([lastUrl().pathname, lastUrl().searchParams.get('include')], ['/animethemes/anime/lumen_tide', 'animethemes.song.artists,series,resources,animesynonyms'], 'anime: the address');
		h.eq([lt.slug, lt.name, lt.year, lt.season, lt.format, lt.series, lt.resources, lt.synonyms.length], ['lumen_tide', 'Lumen Tide', 2019, 'spring', 'TV', ['lumen_tide'], { anilist: 900001, mal: 800001 }, 2], 'anime: the anime, its series, its AniList and MyAnimeList ids, its other names');
		h.eq(lt.themes.map(function (t) { return t.role + t.seq + ' ' + t.title; }), ['OP1 Harbor of Small Lights', 'ED1 Paper Moon Letter', 'insert1 Tidal Lullaby'], 'anime: its themes, OP then ED then inserts');
		h.eq(lt.themes[0], S.find({ key: 'at:song:92001', title: 'Harbor of Small Lights', artist: 'Aoi Minato', people: ['Aoi Minato'], work: 'Lumen Tide', workKey: 'at:anime:lumen_tide', series: 'Lumen Tide', seriesKey: 'at:series:lumen_tide', role: 'OP', seq: 1, season: { year: 2019, season: 'spring' }, year: 2019, source: 'animethemes', ids: { at: 91001, anilist: 900001, mal: 800001 } }), 'anime: a theme as a find');
		var ed = lt.themes[1];
		h.eq([ed.artist, ed.people, L.people(ed.artist).map(function (x) { return x.name + '/' + x.as; })], ['Mio Asahina (CV: Shiori Kanda) & Kaede Tsukishima (CV: Rena Ogura)', ['Shiori Kanda', 'Rena Ogura'], ['Mio Asahina/character', 'Shiori Kanda/cv', 'Kaede Tsukishima/character', 'Rena Ogura/cv']], 'a song sung as characters: the credit library.js people() reads, and the singers');
		var cw = await at.anime('clockwork_meadow');
		h.eq([cw.themes.map(function (t) { return t.role; }), cw.themes[2].title, cw.series, cw.themes[0].series], [['OP', 'ED', 'insert'], HIKARI, [], ''], 'anime: one outside any series');
		var atT = await ttls('at:anime:');
		h.eq([atT['at:anime:lumen_tide'], atT['at:anime:clockwork_meadow']], [180, 14], 'anime: kept 180 days, or 14 while it airs (this season or the last)');
		var nb = asked.length;
		h.eq([await at.anime('no_such_anime'), await at.anime('no_such_anime'), asked.length - nb, (await ttls('at:anime:no'))['at:anime:no_such_anime']], [null, null, 1, 1], 'anime: null when AnimeThemes has no such anime, and that "no" is kept a day');
		var u0 = asked.length;
		var se = await at.series('lumen_tide');
		h.eq(asked.slice(u0).map(function (x) { var q = new URL(x.url); return q.pathname + ' ' + q.searchParams.get('include'); }), ['/animethemes/series/lumen_tide anime.animethemes.song.artists', '/animethemes/series/lumen_tide anime', '/animethemes/anime/lumen_tide_2nd_season animethemes.song.artists,series,resources,animesynonyms', '/animethemes/anime/lumen_tide_the_far_shore animethemes.song.artists,series,resources,animesynonyms'], 'series: the nested include is refused (422, as the real API does), so the series, then each anime not cached yet');
		h.eq([se.slug, se.name, se.anime.map(function (x) { return x.slug + ' ' + x.year + ' ' + x.season; })], ['lumen_tide', 'Lumen Tide', ['lumen_tide 2019 spring', 'lumen_tide_2nd_season 2021 fall', 'lumen_tide_the_far_shore 2023 summer']], 'series: every entry, oldest first');
		h.eq(se.anime.map(function (x) { return x.themes.map(function (t) { return t.role + t.seq; }).join(' '); }), ['OP1 ED1 insert1', 'OP1 OP2 ED1', 'OP1 ED1'], 'series: each entry with its themes');
		h.ok(se.anime.every(function (x) { return x.themes.every(function (t) { return t.series === 'Lumen Tide' && t.seriesKey === 'at:series:lumen_tide'; }); }), 'series: every theme knows its series');
		h.eq([se.anime[2].themes[0].key, se.anime[2].themes[0].work], [se.anime[0].themes[0].key, 'Lumen Tide: The Far Shore'], 'series: a song used again in the film keeps its key (at:song:<song>), so a page can show it once');
		await cache.clear('at:series:');
		var u1 = asked.length;
		await at.series('lumen_tide');
		h.eq(asked.slice(u1).map(function (x) { return new URL(x.url).searchParams.get('include'); }), ['anime'], 'series: once refused, the nested include is not tried again, and each anime comes from the cache');
		sf.set({ atNestedSeries: true });
		var u2 = asked.length;
		var se2 = await S.animeThemes(http, S.createCache({ now: now })).series('lumen_tide');
		h.eq([asked.length - u2, se2.anime.map(function (x) { return x.themes.length; })], [1, [3, 3, 2]], 'series: where the nested include is taken, one request does it');
		sf.set({ atNestedSeries: false });
		var art = await at.artist('aoi_minato');
		h.eq([lastUrl().pathname, lastUrl().searchParams.get('include')], ['/animethemes/artist/aoi_minato', 'songs.animethemes.anime,songs.artists'], 'artist: the address');
		h.eq(art.songs.map(function (x) { return x.year + ' ' + x.title; }), ['2026 Petal Engine', '2026 ' + HIKARI, '2023 The Far Shore', '2021 Lanterns Over Water', '2019 Harbor of Small Lights', '2019 Tidal Lullaby'], 'artist: their anime songs, newest first');
		var harbor = art.songs[4];
		h.eq([art.name, harbor.key, harbor.work, harbor.role, harbor.ids.at, art.songs[0].artist], ['Aoi Minato', 'at:song:92001', 'Lumen Tide', 'OP', 91001, 'Kumori Station & Aoi Minato'], 'artist: a song used twice shows the anime it came from first; a duet keeps both names');
		sf.set({ atPageSize: 2 });
		var u3 = asked.length;
		var fall = await at.season(2026, 'Fall');
		var fu = asked.slice(u3).map(function (x) { return new URL(x.url); });
		h.eq([fu.length, fu[0].pathname, fu[0].searchParams.get('filter[year]'), fu[0].searchParams.get('filter[season]'), fu[0].searchParams.get('include'), fu[0].searchParams.get('page[size]'), fu[1].searchParams.get('page[number]')], [2, '/animethemes/anime', '2026', 'fall', 'animethemes.song.artists,resources', '100', '2'], 'season: the listing, then links.next to the second page');
		h.eq(fall.map(function (x) { return x.slug + ' ' + x.themes.length; }), ['clockwork_meadow 3', 'starlit_bakery 2', 'iron_tulip 1', 'moss_garden_detective 0'], 'season: every anime of the season with its themes (an opening without a song yet is left out)');
		h.eq([fall[0].resources, fall[3].resources, fall[0].format, fall[0].themes[0].work, fall[0].themes[0].season], [{ anilist: 900004, mal: 800004 }, { anilist: 900007, mal: null }, 'TV', 'Clockwork Meadow', { year: 2026, season: 'fall' }], 'season: each with its AniList id (to rank it by popularity)');
		sf.set({ atPageSize: 0 });
		await h.rejects(at.season(2026, 'autumn'), function (x) { return x.code === 'bad'; }, 'season: winter, spring, summer or fall only');

		// AniList
		var al = S.aniList(http, cache);
		var top3 = await al.season(2026, 'fall', { perPage: 3 });
		var post = asked[asked.length - 1], sent = JSON.parse(post.init.body);
		h.eq([post.url, post.init.method, sent.variables], ['http://fixtures.test/anilist', 'POST', { season: 'FALL', year: 2026, perPage: 3 }], 'AniList: one POST to the GraphQL endpoint');
		h.ok(/Page\(page: 1, perPage: \$perPage\)/.test(sent.query) && /media\(season: \$season, seasonYear: \$year, type: ANIME, sort: POPULARITY_DESC/.test(sent.query), 'AniList: the season query, most popular first');
		h.eq(top3[0], { id: 900004, idMal: 800004, title: { romaji: 'Haguruma no Harappa', english: 'Clockwork Meadow', native: sf.fixtures.anilist.response.data.Page.media[0].title.native }, popularity: 48210, cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/fx900004-Clockwork.jpg', format: 'TV', startDate: { year: 2026, month: 10, day: 3 } }, 'AniList: an anime as the page wants it');
		var allFall = await al.season(2026, 'fall');
		h.eq([allFall.length, allFall[4].cover, allFall[4].idMal, allFall[3].title.english, allFall[3].idMal, allFall[4].startDate.day], [5, '', 800009, '', null, null], 'AniList: a cover from another host is dropped; missing parts stay empty');
		h.eq([await al.season(2025, 'winter'), (await ttls('al:'))['al:season:2026:fall:3']], [[], 1], 'AniList: a season with no anime; answers kept a day');

		// iTunes
		var itn = S.iTunes(http, cache);
		var arts = await itn.searchArtist('Aoi Minato');
		var iu = lastUrl();
		h.eq([iu.pathname, iu.searchParams.get('term'), iu.searchParams.get('entity'), iu.searchParams.get('attribute'), iu.searchParams.get('limit'), iu.searchParams.get('country')], ['/itunes/search', 'Aoi Minato', 'musicArtist', 'artistTerm', '10', 'US'], 'iTunes artist search: the address (the US store for a name in Latin letters)');
		h.eq(arts, [{ id: 1700000001, name: 'Aoi Minato', genre: 'Anime', link: 'https://music.apple.com/jp/artist/aoi-minato/1700000001', country: 'US' }, { id: 1700000003, name: 'Aoi Minato Trio', genre: 'Jazz', link: 'https://music.apple.com/jp/artist/aoi-minato-trio/1700000003', country: 'US' }], 'iTunes: the artists found (a namesake too: the caller checks against the library)');
		await itn.searchArtist(String.fromCharCode(0x6E4A, 0x3042, 0x304A, 0x3044));
		var jpCountry = lastUrl().searchParams.get('country');
		await itn.searchArtist('Aoi Minato', { country: 'gb' });
		h.eq([jpCountry, lastUrl().searchParams.get('country')], ['JP', 'GB'], 'iTunes: the Japanese store for a name in Japanese script, or the store asked for');
		var songs = await itn.artistSongs(1700000001, { country: 'JP', limit: 5 });
		h.eq([lastUrl().pathname, lastUrl().searchParams.get('id'), lastUrl().searchParams.get('entity'), lastUrl().searchParams.get('limit'), songs.length], ['/itunes/lookup', '1700000001', 'song', '5', 5], 'iTunes artist songs: a lookup');
		h.eq(songs[0], S.find({ title: 'Harbor of Small Lights', artist: 'Aoi Minato', album: 'Harbor of Small Lights', albumId: 'it:1710000001', year: 2019, durationSec: 252, seq: 1, cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music00/v4/fa/ke/00/fake-1710000001/source/300x300bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview00/v4/fa/ke/00/fake-1720000001/mzaf_1720000001.plus.aac.p.m4a', source: 'itunes', ids: { it: 1720000001 } }), 'iTunes: a song as a find (the album without " - Single", artwork at 300 px, the preview, the track number as seq)');
		h.eq(songs[0].key, 'it:track:1720000001', 'iTunes: keyed it:track:<id>');
		var albs = await itn.albums(1700000001, { country: 'JP' });
		h.eq(albs.map(function (x) { return x.date + ' ' + x.type + ' ' + x.title; }), ['2023-07-19 Single The Far Shore', '2022-06-01 Album Tide Atlas', '2021-11-10 EP Lanterns Over Water', '2019-06-26 Compilation Lumen Tide Original Soundtrack', '2019-04-24 Single Harbor of Small Lights'], 'iTunes albums: newest first, typed (" - EP", " - Single", the collection type, the track count), an album listed twice given once');
		h.eq([albs[1].id, albs[1].trackCount, albs[1].cover, albs[1].link, albs[1].genre, albs[1].artist], [1710000003, 10, 'https://is1-ssl.mzstatic.com/image/thumb/Music00/v4/fa/ke/00/fake-1710000003/source/300x300bb.jpg', 'https://music.apple.com/jp/album/tide-atlas/1710000003', 'J-Pop', 'Aoi Minato'], 'iTunes: an album with its cover and its Apple Music link');
		var tide = await itn.albumTracks(1710000003);
		h.eq(tide.map(function (x) { return x.seq + ' ' + x.title; }), ['1 Tide Atlas', '2 ' + HIKARI, '1 Undertow'], 'iTunes album tracks: disc by disc, track by track');
		h.eq([(await itn.albumTracks(1710000002)).map(function (x) { return x.preview ? 'p' : '-'; }), (await itn.albumTracks(1710000005))[0].cover], [['p', 'p', 'p', '-'], ''], 'iTunes: a preview on plain http and artwork from another host are dropped');
		var sa = await itn.searchAlbums('lumen tide');
		h.eq([sa.map(function (x) { return x.type + ' ' + x.title; }), lastUrl().searchParams.get('entity'), lastUrl().searchParams.get('limit')], [['Compilation Lumen Tide Original Soundtrack'], 'album', '25'], 'iTunes album search');
		var itT = await ttls('it:');
		h.eq([itT['it:q:artist:US:aoi minato'], itT['it:artist:1700000001:songs:JP:5'], itT['it:artist:1700000001:albums:JP'], itT['it:album:1710000003:US']], [30, 7, 3, 90], 'iTunes answers kept: searches 30 days, an artist\'s songs 7, albums 3, an album\'s songs 90');

		// Last.fm
		var noKey = S.lastFm(http, cache, function () { return ''; }), nk = asked.length;
		await h.rejects(noKey.similarTracks('Aoi Minato', 'Harbor of Small Lights'), function (x) { return x.code === 'auth' && /Settings/.test(x.message); }, 'Last.fm without a key: "auth", saying where to add one');
		h.eq([noKey.available(), asked.length - nk], [false, 0], 'Last.fm without a key: nothing is sent');
		var lf = S.lastFm(http, cache, function () { return ' test-key '; });
		var simT = await lf.similarTracks('Aoi Minato', 'Harbor of Small Lights', { limit: 10 });
		var lu = lastUrl();
		h.eq([lu.pathname, lu.searchParams.get('method'), lu.searchParams.get('artist'), lu.searchParams.get('track'), lu.searchParams.get('limit'), lu.searchParams.get('autocorrect'), lu.searchParams.get('api_key'), lu.searchParams.get('format')], ['/lastfm/', 'track.getsimilar', 'Aoi Minato', 'Harbor of Small Lights', '10', '1', 'test-key', 'json'], 'Last.fm: the address, with autocorrect and the key');
		h.eq(simT.map(function (x) { return x.key + ' ' + x.score + ' ' + x.durationSec + ' ' + x.source; }), ['lfm:kumoristation|secondcurrent 1 241 lastfm', 'lfm:hoshizorarelay|gearsong 0.81 0 lastfm', 'lfm:shiorikanda|papermoonletter 0.64 268 lastfm'], 'Last.fm similar songs as finds, keyed by artist and title, scored by match');
		h.ok((await store.cacheRange('lfm:', { now: clock })).every(function (r) { return r.key.indexOf('test-key') < 0 && JSON.stringify(r.value).indexOf('test-key') < 0; }), 'Last.fm: the key is in no cache row');
		h.eq((await lf.similarTracks('Kumori Station', 'Second Current')).map(function (x) { return x.title; }), ['Harbor of Small Lights'], 'Last.fm: a list of one, which Last.fm sends as an object');
		h.eq(await lf.similarArtists('Aoi Minato'), [{ name: 'Kumori Station', match: 1 }, { name: 'Hoshizora Relay', match: 0.734 }], 'Last.fm similar artists');
		h.eq((await lf.topTracks('Aoi Minato', { limit: 2 })).map(function (x) { return x.title + ' ' + x.key; }), ['Harbor of Small Lights lfm:aoiminato|harborofsmalllights', 'Lanterns Over Water lfm:aoiminato|lanternsoverwater'], 'Last.fm top songs');
		h.eq([await lf.similarTracks('Nobody', 'Nothing'), lf.available()], [[], true], 'Last.fm: a song it does not know (error 6) gives none');
		h.eq((await ttls('lfm:'))['lfm:sim:aoiminato|harborofsmalllights:10'], 14, 'Last.fm answers kept 14 days');

		// ---- yt.js's searches and ytLists, over HTTP against the fake
		var fake = await mod.startFake();
		try {
			var ep = Y.endpoints({ search: '?api=' + fake.url, hostname: '127.0.0.1', storage: null });
			var spent = [], ytAsked = [];
			var client = Y.createClient({ getToken: function () { return null; }, getApiKey: function () { return 'test-api-key'; }, endpoints: ep, sleep: function () { return Promise.resolve(); }, onQuota: function (u, method) { spent.push(method + ' ' + u); }, fetch: function (u, opts) { ytAsked.push(new URL(u)); return fetch(u, opts); } });
			function lastYt() { return ytAsked[ytAsked.length - 1].searchParams; }
			var music = await client.search('harbor small lights', { max: 10 });
			h.eq([lastYt().get('type'), lastYt().get('videoCategoryId'), lastYt().get('videoEmbeddable'), lastYt().get('maxResults')], ['video', '10', 'true', '10'], 'client.search: Music (category 10) by default');
			h.eq(music.map(function (v) { return v.videoId; }), ['fakeS000001', 'fakeS000002'], 'client.search: the creditless opening (Film & Animation) and the cover that cannot be embedded are not found');
			var anyCat = await client.search('harbor small lights', { max: 10, category: null });
			h.eq([lastYt().has('videoCategoryId'), anyCat.map(function (v) { return v.videoId; })], [false, ['fakeS000001', 'fakeS000002', 'fakeS000003']], 'client.search with category null: every category, so the official channel\'s creditless opening is found');
			await client.search('creditless', { category: '' });
			var emptyCat = lastYt().has('videoCategoryId');
			var film = await client.search('lumen tide creditless', { max: 10, category: '1' });
			h.eq([emptyCat, film.map(function (v) { return v.videoId; })], [false, ['fakeS000003', 'fakeS000009']], 'client.search: category \'\' is every category too; category 1 is Film & Animation only');
			var pls = await client.searchPlaylists('tide atlas');
			h.eq([lastYt().get('type'), lastYt().get('maxResults'), lastYt().has('videoCategoryId'), lastYt().get('part')], ['playlist', '10', false, 'snippet'], 'client.searchPlaylists: type=playlist, ten by default');
			h.eq(pls, [{ playlistId: 'OLAK5uy_fakeTideAtlasAlbum000000000000000', title: 'Album - Tide Atlas', channel: 'Aoi Minato - Topic', channelId: 'UCfakeTopicAoiMinato0001', publishedAt: '2022-06-01T07:00:00Z' }], 'client.searchPlaylists: an album list, with its channel');
			await client.searchPlaylists('tide', { max: 99 });
			var most = lastYt().get('maxResults');
			await client.searchPlaylists('tide', { max: -3 });
			h.eq([most, lastYt().get('maxResults')], ['25', '1'], 'client.searchPlaylists: between 1 and 25 results');
			h.eq([spent.length, spent.every(function (s) { return s === 'search.list 100'; }), client.quota().units, fake.stats.units], [7, true, 700, 700], 'every search costs 100 units (Y.UNITS[\'search.list\']), counted through onQuota as the fake counts it');

			var yclock = Date.UTC(2026, 9, 10, 12), ystore = Store.memory();
			var yl = S.ytLists(client, S.createCache({ store: ystore, now: function () { return yclock; } }));
			var pages0 = fake.stats.byMethod['playlistItems.list'] || 0;
			var up = await yl.uploads('UCfakeTopicAoiMinato0001', { max: 20 });
			h.eq([lastYt().get('playlistId'), lastYt().get('maxResults'), up.length, fake.stats.byMethod['playlistItems.list'] - pages0], ['UUfakeTopicAoiMinato0001', '50', 20, 1], 'uploads: the channel\'s UU list, one page of 50 (1 unit), twenty asked for');
			h.ok(up.every(function (x) { return x.videoId && x.key === 'v:' + x.videoId && x.source === 'ytuploads' && x.channelId === 'UCfakeTopicAoiMinato0001' && x.title && typeof x.addedAt === 'string'; }), 'uploads: finds with their video, title, channel and the date each was added');
			var more = await yl.uploads('UCfakeTopicAoiMinato0001', { max: 30 });
			h.eq([more.length > 20, fake.stats.byMethod['playlistItems.list'] - pages0], [true, 1], 'uploads: the whole page was kept, so asking for more of a short list sends nothing');
			var album = await yl.playlist('OLAK5uy_fakeTideAtlasAlbum000000000000000');
			h.eq(album.map(function (x) { return x.videoId + ' ' + x.title + ' / ' + x.channel + ' ' + x.source; }), ['fakeS000006 Tide Atlas / Aoi Minato - Topic ytplaylist', 'fakeS000001 Harbor of Small Lights / Aoi Minato - Topic ytplaylist', 'fakeS000007 Undertow / Aoi Minato - Topic ytplaylist'], 'playlist: an album list in order, each with its channel');
			var listRows = {};
			(await ystore.cacheRange('yt:list:', { now: yclock })).forEach(function (r) { listRows[r.key] = (r.exp - yclock) / 3600000; });
			h.eq([listRows['yt:list:UUfakeTopicAoiMinato0001'], listRows['yt:list:OLAK5uy_fakeTideAtlasAlbum000000000000000']], [6, 168], 'lists are kept under yt:list:<id>: uploads 6 hours, other lists 7 days');
			var vb0 = fake.stats.byMethod['videos.list'] || 0;
			var vids = await yl.videos(['fakeS000001', 'fake0000041', 'fakeS000003', 'not-an-id']);
			h.eq([vids.videos.map(function (v) { return v.id + ' ' + v.durationSec + ' ' + v.categoryId; }), vids.missing], [['fakeS000001 252 10', 'fakeS000003 91 1'], ['fake0000041', 'not-an-id']], 'videos: the details (videoBatch), and what YouTube does not have');
			await yl.videos(['fakeS000001', 'fake0000041']);
			h.eq(fake.stats.byMethod['videos.list'] - vb0, 1, 'videos: each is kept, a missing one too, so asking again sends nothing');
			var q0 = fake.stats.units;
			var sv = await yl.searchVideos('Harbor Small Lights', { max: 2 });
			var sv1 = await yl.searchVideos('harbor  small lights', { max: 1 });
			h.eq([sv.map(function (v) { return v.videoId; }), sv1.map(function (v) { return v.videoId; }), fake.stats.units - q0], [['fakeS000001', 'fakeS000002'], ['fakeS000001'], 100], 'searchVideos: one search (100 units); the same words again, asking for fewer, come from the cache');
			await yl.searchVideos('harbor small lights', { max: 5 });
			var anyV = await yl.searchVideos('harbor small lights', { category: null });
			h.eq([anyV.length, fake.stats.units - q0], [3, 300], 'searchVideos: asking for more than was kept searches again; every category is a search of its own');
			var slp = await yl.searchPlaylists('tide atlas');
			await yl.searchPlaylists('Tide Atlas');
			h.eq([slp.length, fake.stats.units - q0], [1, 400], 'searchPlaylists: kept like a video search');
			var ytRows = await ystore.cacheRange('yt:', { now: yclock });
			h.ok(ytRows.length > 0 && ytRows.every(function (r) { return r.exp - yclock <= 30 * DAY; }), 'nothing from YouTube is kept longer than 30 days');
			h.eq(ytRows.filter(function (r) { return /^yt:q:/.test(r.key); }).map(function (r) { return r.key; }), ['yt:q:playlist:tide atlas', 'yt:q:video-any:harbor small lights', 'yt:q:video:harbor small lights'], 'searches are kept under yt:q:<kind>:<words>');
			await h.rejects(yl.uploads('not a channel'), function (x) { return x.code === 'bad'; }, 'uploads: a channel id must look like one');
		} finally {
			await fake.close();
		}

		// ---- Deezer, through discover.js, as finds with a lasting cache
		var dzData = {
			'search/artist?q=Paper%20Lanterns&limit=6': { data: [{ id: 7, name: 'Paper Lanterns', nb_fan: 1200, picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/abc/250x250-000000-80-0-0.jpg' }] },
			'artist/7/related?limit=20': { data: [{ id: 8, name: 'Glass Orchard', nb_fan: 50, picture_medium: 'https://evil.example/x.jpg' }] },
			'artist/7/top?limit=5': { data: [{ id: 71, title: 'Blue Signal (Live)', title_short: 'Blue Signal', title_version: '(Live)', duration: 201, preview: 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/x.mp3?hdnea=exp=1', artist: { id: 7, name: 'Paper Lanterns' }, album: { id: 700, title: 'Harbor Lights', cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/def/250x250-000000-80-0-0.jpg' } }] },
			'artist/7/albums?limit=50': { data: [{ id: 700, title: 'Harbor Lights', release_date: '2024-03-01', record_type: 'single', cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/def/250x250-000000-80-0-0.jpg', fans: 3 }, { id: 701, title: 'Paper Weather', release_date: '2025-05-05', record_type: 'album', cover_medium: '', fans: 9 }] },
			'album/700/tracks?limit=60': { data: [{ id: 71, title: 'Blue Signal', duration: 201, preview: 'https://cdnt-preview.dzcdn.net/x.mp3', artist: { id: 7, name: 'Paper Lanterns' } }] },
			'artist/7/radio?limit=40': { data: [{ id: 81, title: 'Window', duration: 180, preview: 'https://cdns-preview-e.dzcdn.net/stream/x.mp3', artist: { id: 8, name: 'Glass Orchard' }, album: { title: 'Glass', cover_medium: 'https://cdn-images.dzcdn.net/images/cover/x.jpg' } }] }
		};
		var dzCalls = [];
		function makeDz() { return D.createDeezer({ gapMs: 0, transport: function (u) { dzCalls.push(u); var key = u.replace(D.API, ''); return dzData[key] ? Promise.resolve(dzData[key]) : Promise.reject(new Error('Deezer could not be reached (network).')); } }); }
		var dclock = Date.UTC(2026, 9, 10, 12), dnow = function () { return dclock; }, dstore = Store.memory();
		var df = S.deezerFinds(makeDz(), S.createCache({ store: dstore, now: dnow }));
		var dtop = await df.top(7);
		h.eq(dtop[0], S.find({ title: 'Blue Signal', version: '(Live)', artist: 'Paper Lanterns', album: 'Harbor Lights', durationSec: 201, cover: 'https://e-cdns-images.dzcdn.net/images/cover/def/250x250-000000-80-0-0.jpg', preview: 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/x.mp3?hdnea=exp=1', source: 'deezer', ids: { dz: 71 } }), 'Deezer top songs as finds');
		h.eq(dtop[0].key, 'dz:track:71', 'Deezer: keyed dz:track:<id>');
		var dn = dzCalls.length;
		var dtop2 = await S.deezerFinds(makeDz(), S.createCache({ store: dstore, now: dnow })).top(7);
		h.eq([dzCalls.length - dn, dtop2[0].key], [0, 'dz:track:71'], 'Deezer: kept under dz:<path> in the store, so after a reload (a new Deezer client) nothing is asked again');
		h.eq(await df.related(7), [{ id: 8, name: 'Glass Orchard', picture: '', fans: 50 }], 'Deezer related artists (a picture from another host dropped)');
		var dal = await df.albums(7);
		h.eq(dal.map(function (x) { return x.type + ' ' + x.title + ' ' + x.date; }), ['Album Paper Weather 2025-05-05', 'Single Harbor Lights 2024-03-01'], 'Deezer albums: newest first, typed as iTunes albums are');
		var dat = await df.albumTracks(dal[1]);
		h.eq([dat[0].albumId, dat[0].cover, dat[0].album, dat[0].key], ['dz:700', dal[1].cover, 'Harbor Lights', 'dz:track:71'], 'Deezer album tracks, each with its album');
		var drad = await df.radio(7);
		h.eq([drad[0].key, drad[0].preview, drad[0].artist, drad[0].cover], ['dz:track:81', 'https://cdns-preview-e.dzcdn.net/stream/x.mp3', 'Glass Orchard', 'https://cdn-images.dzcdn.net/images/cover/x.jpg'], 'Deezer artist mix as finds');
		h.eq((await df.searchArtists('Paper Lanterns'))[0], { id: 7, name: 'Paper Lanterns', picture: 'https://e-cdns-images.dzcdn.net/images/artist/abc/250x250-000000-80-0-0.jpg', fans: 1200 }, 'Deezer artist search');
		var derr = await caught(df.related(999));
		h.eq([derr.code, derr.host, derr.message], ['network', 'deezer', 'Deezer did not answer. Try again in a moment.'], 'Deezer: a failure is a SourceError a lane can show');
		h.ok((await dstore.cacheRange('dz:', { now: dclock })).every(function (r) { return r.exp - dclock === 7 * DAY; }), 'Deezer answers are kept 7 days');
	});
};
