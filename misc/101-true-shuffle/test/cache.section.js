/*
 * The cache: store.js's cache calls (on the in-memory twin; the IndexedDB
 * half is checked in a browser) and sources.js createCache (time limits, the
 * 30-day cap on anything from YouTube, the in-memory front, wrap's "no",
 * the sweep). Loaded by test.js, which runs it as the section "cache".
 */
'use strict';
var path = require('path');

module.exports = function (h) {
	h.describe('cache', async function () {
		var Store = require(path.join(h.HERE, 'store.js'));
		var S = require(path.join(h.HERE, 'sources.js'));
		var DAY = 86400000, T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
		var i;

		// ---- store.js: the cache calls
		h.eq(Store.DB_VERSION, 2, 'the database is at version 2, which adds the cache store');
		var s = Store.memory();
		h.eq(await s.cachePut([
			{ key: 'at:anime:a', value: { n: 1 }, exp: T0 + DAY },
			{ key: 'at:anime:b', value: [1, 2], exp: T0 + 2 * DAY, at: T0 - 5 },
			{ key: 'it:old', value: 'stale', exp: T0 - 1 }
		], { now: T0 }), 3, 'cachePut: three rows');
		h.eq(await s.cacheGet(['at:anime:a', 'at:anime:b', 'it:old', 'nope'], { now: T0 }), { 'at:anime:a': { n: 1 }, 'at:anime:b': [1, 2] }, 'cacheGet: the values of the keys that are there; an expired row counts as missing');
		h.eq(await s.cacheGet('at:anime:a', { now: T0 + DAY }), {}, 'cacheGet: a row is gone at its expiry time (and one key may be given bare)');
		h.eq(await s.cacheGet(['at:anime:a', 'at:anime:b'], { now: T0, rows: true }), { 'at:anime:a': { value: { n: 1 }, exp: T0 + DAY, at: T0 }, 'at:anime:b': { value: [1, 2], exp: T0 + 2 * DAY, at: T0 - 5 } }, 'cacheGet with rows: each value with its expiry and when it was stored');
		var held = await s.cacheGet(['at:anime:a'], { now: T0 });
		held['at:anime:a'].n = 99;
		h.eq((await s.cacheGet(['at:anime:a'], { now: T0 }))['at:anime:a'].n, 1, 'cacheGet: values are copies');
		h.eq(await s.cacheGet([], { now: T0 }), {}, 'cacheGet of nothing');
		await h.rejects(s.cachePut([{ key: 'k', value: 1 }]), function (e) { return /expiry/.test(e.message); }, 'cachePut: a row without an expiry is refused with a sentence');
		await h.rejects(s.cachePut([{ key: 'ok', value: 1, exp: T0 + DAY }, { value: 1, exp: T0 + DAY }]), null, 'cachePut: a row without a key is refused');
		h.eq(await s.cacheGet(['ok'], { now: T0 }), {}, 'cachePut: a refused call stores none of its rows');
		h.eq(await s.cacheRange('at:', { now: T0 }), [{ key: 'at:anime:a', value: { n: 1 }, exp: T0 + DAY, at: T0 }, { key: 'at:anime:b', value: [1, 2], exp: T0 + 2 * DAY, at: T0 - 5 }], 'cacheRange: the unexpired rows under a prefix, in key order');
		h.eq((await s.cacheRange('', { now: T0 })).length, 2, 'cacheRange of every key leaves out the expired row');
		await s.cacheDelete(['at:anime:a', 'nope']);
		h.eq(Object.keys(await s.cacheGet(['at:anime:a', 'at:anime:b'], { now: T0 })), ['at:anime:b'], 'cacheDelete');

		// the sweep: expired rows first, then the nearest to expiry until under both limits
		var sw = Store.memory(), rows = [];
		for (i = 0; i < 3; i++) rows.push({ key: 'old:' + i, value: 'x', exp: T0 - (i + 1) * 1000 });
		for (i = 0; i < 6; i++) rows.push({ key: 'k:' + i, value: 'v'.repeat(100), exp: T0 + (6 - i) * DAY });
		await sw.cachePut(rows, { now: T0 });
		var sweep = await sw.cacheSweep({ now: T0, maxRows: 4 });
		h.eq(sweep, { expired: 3, evicted: 2, rows: 4, bytes: 4 * (3 + 102) }, 'cacheSweep: 3 expired rows go, then 2 more to keep 4 rows (sizes: key plus value as JSON)');
		h.eq((await sw.cacheRange('', { now: T0 })).map(function (r) { return r.key; }), ['k:0', 'k:1', 'k:2', 'k:3'], 'cacheSweep: the rows nearest to expiry were the ones taken');
		h.eq(await sw.cacheSweep({ now: T0, maxBytes: 250 }), { expired: 0, evicted: 2, rows: 2, bytes: 210 }, 'cacheSweep: a byte limit takes the nearest to expiry until under it');
		h.eq(await sw.cacheSweep({ now: T0 }), { expired: 0, evicted: 0, rows: 2, bytes: 210 }, 'cacheSweep: the defaults (5,000 rows, 12 MB) leave a small cache alone');
		h.eq(await sw.cacheSweep({ now: T0 + 10 * DAY }), { expired: 2, evicted: 0, rows: 0, bytes: 0 }, 'cacheSweep: later, everything has expired');

		// clearing, wiping, exporting, counting
		var c = Store.memory();
		await c.putTracks([{ id: 't1', title: 'One' }]);
		await c.set('library', { v: 1 });
		await c.set('import:PL1', { phase: 'list' });
		await c.cachePut([{ key: 'yt:list:UUx', value: [1], exp: T0 + DAY }, { key: 'yt:q:video:a', value: [2], exp: T0 + DAY }, { key: 'at:anime:z', value: { z: 1 }, exp: T0 + DAY }], { now: T0 });
		var use = await c.usage();
		h.eq([use.tracks, use.kv, use.cache, use.cacheBytes > 0], [1, 2, 3, true], 'usage: counts the cache rows and their bytes while it holds anything');
		var exported = await c.exportAll(T0);
		h.ok(!('cache' in exported) && JSON.stringify(exported).indexOf('UUx') < 0 && Object.keys(exported.kv).join() === 'library', 'exportAll: the cache is left out of a backup, as import progress is');
		await c.cacheClear('yt:');
		h.eq((await c.cacheRange('', { now: T0 })).map(function (r) { return r.key; }), ['at:anime:z'], 'cacheClear(prefix): only the keys under it');
		await c.cacheClear();
		h.eq(await c.cacheRange('', { now: T0 }), [], 'cacheClear(): all of it');
		h.eq(await c.usage(), { tracks: 1, playlists: 0, kv: 2, history: 0, bytes: null }, 'usage: an empty cache adds nothing to the counts');
		await c.cachePut([{ key: 'oe:abc', value: { ok: true }, exp: T0 + DAY }], { now: T0 });
		await c.importAll(JSON.parse(JSON.stringify(exported)));
		h.eq(Object.keys(await c.cacheGet(['oe:abc'], { now: T0 })), ['oe:abc'], 'importAll: a backup replaces the data, and leaves the cache alone');
		await c.wipe();
		h.eq([await c.cacheRange('', { now: T0 }), (await c.usage()).tracks], [[], 0], 'wipe: the cache goes with everything else');
		await c.destroy();
		await h.rejects(c.cacheGet(['oe:abc'], { now: T0 }), null, 'destroy: the cache cannot be used afterwards');

		// ---- sources.js createCache
		var clock = T0, now = function () { return clock; };
		var st = Store.memory(), cache = S.createCache({ store: st, now: now });
		await cache.put('at:anime:x', { name: 'X' }, 3 * DAY);
		h.eq(await cache.get('at:anime:x'), { name: 'X' }, 'get: what was put');
		h.eq(await cache.get('at:anime:missing'), undefined, 'get: undefined when there is nothing');
		var r1 = await st.cacheGet(['at:anime:x'], { now: T0, rows: true });
		h.eq([r1['at:anime:x'].exp, r1['at:anime:x'].at], [T0 + 3 * DAY, T0], 'put: the row lands in the store with its expiry');
		await cache.put('yt:list:UUabc', ['a'], 90 * DAY);
		await cache.put('oe:abcdefghijk', { ok: true }, 365 * DAY);
		await cache.put('at:track:y', 1, 90 * DAY);
		var capped = await st.cacheGet(['yt:list:UUabc', 'oe:abcdefghijk', 'at:track:y'], { now: T0, rows: true });
		h.eq([capped['yt:list:UUabc'].exp - T0, capped['oe:abcdefghijk'].exp - T0, capped['at:track:y'].exp - T0].map(function (ms) { return ms / DAY; }), [30, 30, 90], 'put: anything under yt: or oe: is kept 30 days at most, whatever was asked; other keys keep their time');
		clock = T0 + 3 * DAY;
		h.eq(await cache.get('at:anime:x'), undefined, 'get: gone once its time is over (from the in-memory front too)');
		h.eq(await S.createCache({ store: st, now: now }).get('at:track:y'), 1, 'a new cache on the same store reads what an earlier one kept');
		clock = T0;
		h.eq(await cache.getMany(['at:anime:x', 'yt:list:UUabc', 'nope', 'yt:list:UUabc']), { 'at:anime:x': { name: 'X' }, 'yt:list:UUabc': ['a'] }, 'getMany: the keys that are there (asked twice, given once)');
		var mixed = S.createCache({ store: st, now: now });
		h.eq(await mixed.getMany(['at:anime:x', 'at:track:y']), { 'at:anime:x': { name: 'X' }, 'at:track:y': 1 }, 'getMany: from the store when the in-memory front is empty');
		h.eq(mixed.stats(), { hits: 2, misses: 0, rows: 2 }, 'stats: hits, misses, and the rows held in memory');
		var v = await cache.get('at:anime:x');
		v.name = 'changed';
		h.eq((await cache.get('at:anime:x')).name, 'X', 'get: a copy, so changing it changes nothing kept');

		// the in-memory front is small and keeps the most recent
		var small = S.createCache({ store: Store.memory(), now: now, memoryMax: 2 });
		await small.put('a', 1, DAY); await small.put('b', 2, DAY); await small.put('c', 3, DAY);
		h.eq(small.stats().rows, 2, 'memoryMax: the front holds at most that many');
		h.eq([await small.get('a'), await small.get('c')], [1, 3], 'an entry pushed out of the front still comes from the store');
		var mem = S.createCache({ now: now });
		await mem.put('k', { a: 1 }, DAY);
		h.eq([await mem.get('k'), await mem.get('none')], [{ a: 1 }, undefined], 'without a store the cache lives in memory only');

		// wrap: the cached value, else fn's; a "no" for a while; one fn call at a time
		var calls = 0, wc = S.createCache({ store: Store.memory(), now: now });
		var fn = function () { calls++; return Promise.resolve({ got: calls }); };
		h.eq([await wc.wrap('at:anime:w', DAY, fn), await wc.wrap('at:anime:w', DAY, fn), calls], [{ got: 1 }, { got: 1 }, 1], 'wrap: fn runs once, then its answer is reused');
		var slow = 0;
		var both = await Promise.all([wc.wrap('at:anime:s', DAY, function () { slow++; return new Promise(function (r) { setTimeout(function () { r('done'); }, 5); }); }), wc.wrap('at:anime:s', DAY, function () { slow++; return 'second'; })]);
		h.eq([both, slow], [['done', 'done'], 1], 'wrap: two calls for one key at the same time share one fn call');
		var nf = 0;
		var notFound = function () { nf++; return Promise.reject(S.SourceError('not-found', 'Nothing there.', { host: 'animethemes' })); };
		h.eq(await wc.wrap('at:anime:none', 30 * DAY, notFound, { negTtlMs: DAY }), null, 'wrap: a not-found answer resolves null');
		h.eq([await wc.wrap('at:anime:none', 30 * DAY, notFound, { negTtlMs: DAY }), nf], [null, 1], 'wrap: and the "no" is kept: fn is not asked again');
		clock = T0 + DAY;
		h.eq([await wc.wrap('at:anime:none', 30 * DAY, notFound, { negTtlMs: DAY }), nf], [null, 2], 'wrap: once negTtlMs is over, fn is asked again');
		clock = T0;
		var boom = 0;
		await h.rejects(wc.wrap('at:anime:err', DAY, function () { boom++; return Promise.reject(S.SourceError('server', 'AnimeThemes is having trouble answering. Try again later.', { host: 'animethemes' })); }), function (e) { return e.code === 'server'; }, 'wrap: any other error is passed on');
		await h.rejects(wc.wrap('at:anime:err', DAY, function () { boom++; return Promise.reject(S.SourceError('server', 'x')); }), null, 'wrap: and is not kept');
		h.eq(boom, 2, 'wrap: a failed fn is asked again next time');
		h.eq(await wc.wrap('at:anime:nul', DAY, function () { return null; }), null, 'wrap: a null answer is a "no" as well');
		var ttlSeen = await wc.wrap('at:anime:fn', function (val) { return val.airing ? 14 * DAY : 180 * DAY; }, function () { return { airing: true }; });
		var fnRow = (await wc.range('at:anime:fn'))[0];
		h.eq([ttlSeen, fnRow.exp - T0], [{ airing: true }, 14 * DAY], 'wrap: the time may depend on the answer (a function of it)');
		h.eq((await wc.range('at:anime:n')).map(function (r) { return r.key; }), ['at:anime:none', 'at:anime:nul'], 'range: the keys under a prefix, "no" answers included');

		// wrap and signals
		var ac = new AbortController(), started = 0, release;
		var first = wc.wrap('at:anime:sig', DAY, function () { started++; return new Promise(function (r) { release = r; }); }, { signal: ac.signal });
		var second = wc.wrap('at:anime:sig', DAY, function () { started++; return Promise.resolve('for the second'); });
		await h.tickAll();
		ac.abort();
		await h.rejects(first, function (e) { return e.code === 'aborted'; }, 'wrap: the caller whose signal fired is told "aborted"');
		release('late answer');
		h.eq(await second, 'late answer', 'wrap: another caller sharing the work still gets the answer');
		var ac2 = new AbortController();
		ac2.abort();
		await h.rejects(wc.wrap('at:anime:pre', DAY, function () { return 1; }, { signal: ac2.signal }), function (e) { return e.code === 'aborted'; }, 'wrap: a signal that has fired already stops it at once');

		// sweep, clear, remove
		var sc = S.createCache({ store: Store.memory(), now: now });
		await sc.put('dz:a', 1, DAY); await sc.put('dz:b', 2, 3 * DAY); await sc.put('lfm:c', 3, 3 * DAY);
		clock = T0 + 2 * DAY;
		h.eq(await sc.sweep(), { expired: 1, evicted: 0, rows: 2, bytes: (4 + 1) + (5 + 1) }, 'sweep: the expired entry goes, from the store and the front');
		h.eq((await sc.range('')).map(function (r) { return r.key; }), ['dz:b', 'lfm:c'], 'range: what is left');
		await sc.clear('dz:');
		h.eq([await sc.get('dz:b'), await sc.get('lfm:c')], [undefined, 3], 'clear(prefix)');
		await sc.remove(['lfm:c']);
		h.eq(await sc.get('lfm:c'), undefined, 'remove(keys)');
		clock = T0;
		var ms = S.createCache({ now: now });
		await ms.put('a', 1, DAY); await ms.put('b', 'xy', 3 * DAY);
		clock = T0 + 2 * DAY + 1;
		h.eq(await ms.sweep(), { expired: 1, evicted: 0, rows: 1, bytes: 1 + 4 }, 'sweep without a store: the in-memory entries');
		await ms.clear();
		h.eq(ms.stats().rows, 0, 'clear() without a prefix: everything');
		clock = T0;
	});
};
