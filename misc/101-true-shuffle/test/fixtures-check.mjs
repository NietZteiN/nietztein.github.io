/*
 * Are the fixtures still shaped like the real answers? Run by hand, now and
 * then (it is not part of test.js):
 *
 *     node misc/101-true-shuffle/test/fixtures-check.mjs
 *
 * It asks the free sources a few real questions through sources.js's own
 * clients, so the requests are exactly the ones the page sends:
 *   AnimeThemes   a search, an anime, a series (and whether the nested include
 *                 is still refused), an artist, this season's listing
 *   AniList       this season's most popular anime
 *   iTunes        an artist search, the artist's albums, an album's songs
 *   YouTube       one oEmbed answer (YouTube's own IFrame API sample video)
 * and asks test/fake-youtube.mjs the same kind of questions about its invented
 * data. Never the YouTube Data API (that spends quota) and never Last.fm (that
 * needs a key). The questions are fixed here; nothing about the listener is
 * sent, and the User-Agent is "fixtures-check". The sources' own spacing is
 * kept (iTunes: 3.1 s between requests).
 *
 * Then the shapes are compared. A key the code reads (REQUIRED below) that the
 * real answer lacks, or whose value has another type, is a failure: exit 1.
 * Other differences are printed as notes: keys only the real answer has, and
 * keys only the fake has.
 */
import { createRequire } from 'node:module';
import { startFake } from './fake-youtube.mjs';

const require = createRequire(import.meta.url);
const S = require('../sources.js');

// What sources.js reads, per answer. Each entry: a path prefix and its keys.
const at = (prefix, keys) => keys.map((k) => prefix + '.' + k);
const REQUIRED = {
	'AnimeThemes /search': [].concat(
		at('$.search.anime[]', ['slug', 'name', 'year', 'season']),
		at('$.search.series[]', ['slug', 'name']),
		at('$.search.songs[]', ['id', 'title']),
		at('$.search.songs[].artists[]', ['name', 'artistsong']),
		at('$.search.songs[].artists[].artistsong', ['as', 'relevance']),
		at('$.search.songs[].animethemes[]', ['id', 'type', 'sequence', 'slug', 'anime']),
		at('$.search.songs[].animethemes[].anime', ['slug', 'name', 'year', 'season']),
		at('$.search.artists[]', ['slug', 'name'])),
	'AnimeThemes /anime/:x': [].concat(
		at('$.anime', ['slug', 'name', 'year', 'season', 'media_format', 'animethemes', 'series', 'resources', 'animesynonyms']),
		at('$.anime.animethemes[]', ['id', 'type', 'sequence', 'slug', 'song']),
		at('$.anime.animethemes[].song', ['id', 'title', 'artists']),
		at('$.anime.animethemes[].song.artists[]', ['name', 'artistsong']),
		at('$.anime.animethemes[].song.artists[].artistsong', ['as', 'relevance']),
		at('$.anime.series[]', ['slug', 'name']),
		at('$.anime.resources[]', ['site', 'external_id']),
		at('$.anime.animesynonyms[]', ['text'])),
	'AnimeThemes /series/:x': [].concat(
		at('$.series', ['slug', 'name', 'anime']),
		at('$.series.anime[]', ['slug', 'name', 'year', 'season'])),
	'AnimeThemes /artist/:x': [].concat(
		at('$.artist', ['slug', 'name', 'songs']),
		at('$.artist.songs[]', ['id', 'title', 'artists', 'animethemes']),
		at('$.artist.songs[].artists[]', ['name', 'artistsong']),
		at('$.artist.songs[].animethemes[]', ['id', 'type', 'sequence', 'slug', 'anime']),
		at('$.artist.songs[].animethemes[].anime', ['slug', 'name', 'year', 'season'])),
	'AnimeThemes /anime': [].concat(
		at('$', ['anime', 'links']),
		at('$.links', ['next']),
		at('$.anime[]', ['slug', 'name', 'year', 'season', 'media_format', 'animethemes', 'resources']),
		at('$.anime[].animethemes[]', ['id', 'type', 'sequence', 'slug', 'song']),
		at('$.anime[].animethemes[].song', ['id', 'title', 'artists']),
		at('$.anime[].animethemes[].song.artists[]', ['name', 'artistsong']),
		at('$.anime[].resources[]', ['site', 'external_id'])),
	'AniList': [].concat(
		at('$.data.Page', ['media']),
		at('$.data.Page.media[]', ['id', 'idMal', 'title', 'popularity', 'coverImage', 'format', 'startDate']),
		at('$.data.Page.media[].title', ['romaji', 'english', 'native']),
		at('$.data.Page.media[].coverImage', ['medium']),
		at('$.data.Page.media[].startDate', ['year', 'month', 'day'])),
	'iTunes': [].concat(
		at('$', ['resultCount', 'results']),
		at('$.results[]', ['wrapperType', 'artistId', 'artistName', 'primaryGenreName', 'artistLinkUrl',
			'collectionId', 'collectionName', 'collectionType', 'trackCount', 'releaseDate', 'artworkUrl100', 'collectionViewUrl',
			'kind', 'trackId', 'trackName', 'trackNumber', 'discNumber', 'trackTimeMillis', 'previewUrl'])),
	'YouTube oEmbed': at('$', ['title', 'author_name', 'author_url'])
};

// ---- recording what each side answers
function routeOf(u) {
	const x = new URL(u);
	let p = x.pathname;
	if (x.hostname === 'api.animethemes.moe' || p.startsWith('/animethemes')) {
		p = p.replace(/^\/animethemes/, '').replace(/^\/(anime|series|artist)\/[^/]+$/, '/$1/:x');
		return 'AnimeThemes ' + p;
	}
	if (x.hostname === 'graphql.anilist.co' || p.startsWith('/anilist')) return 'AniList';
	if (x.hostname === 'itunes.apple.com' || p.startsWith('/itunes')) return 'iTunes';
	if (p.endsWith('/oembed')) return 'YouTube oEmbed';
	return x.hostname + p;
}
// AnimeThemes sits behind Cloudflare, which answers Node's own User-Agent
// ("node") with a 403 page (seen 2026-10-10); a browser sends its own. This
// script says only what it is.
function recorder(log) {
	return async (u, init) => {
		const res = await fetch(u, Object.assign({}, init, { headers: Object.assign({ 'User-Agent': 'fixtures-check' }, init && init.headers) }));
		let json;
		try { json = JSON.parse(await res.clone().text()); } catch { json = undefined; }
		log.push({ url: u, route: routeOf(u), status: res.status, json });
		return res;
	};
}

// ---- shapes: every path with the types seen there
function shapeOf(values) {
	const out = new Map();
	const add = (p, t) => { if (!out.has(p)) out.set(p, new Set()); out.get(p).add(t); };
	const walk = (v, p) => {
		const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
		add(p, t);
		if (t === 'array') v.forEach((x) => walk(x, p + '[]'));
		else if (t === 'object') Object.keys(v).forEach((k) => walk(v[k], p + '.' + k));
	};
	values.forEach((v) => walk(v, '$'));
	return out;
}
const parentOf = (p) => (p.endsWith('[]') ? p.slice(0, -2) : p.slice(0, p.lastIndexOf('.')));
const solid = (types) => [...(types || [])].filter((t) => t !== 'null');

function compare(route, live, fake) {
	const out = { route, fail: [], unseen: [], liveOnly: [], fakeOnly: [] };
	const L = shapeOf(live), F = shapeOf(fake), need = REQUIRED[route] || [];
	for (const p of need) {
		if (L.has(p)) {
			const a = solid(L.get(p)), b = solid(F.get(p));
			if (a.length && b.length && !a.some((t) => b.includes(t))) out.fail.push(p + ' is ' + a.join('|') + ' in the real answer, ' + b.join('|') + ' in the fake');
			if (!F.has(p)) out.fail.push(p + ' is read by sources.js but the fake does not have it');
			continue;
		}
		// not there: missing, or only unseen because what holds it was empty or null
		let anc = parentOf(p);
		while (anc.length > 1 && !L.has(anc)) anc = parentOf(anc);
		const at = L.get(anc), emptyList = at && at.has('array') && ![...L.keys()].some((k) => k.startsWith(anc + '[]'));
		if (at && (solid(at).length === 0 || emptyList)) out.unseen.push(p);
		else out.fail.push(p + ' is missing from the real answer');
	}
	for (const p of L.keys()) if (!F.has(p)) out.liveOnly.push(p);
	for (const p of F.keys()) if (!L.has(p) && !need.includes(p)) out.fakeOnly.push(p);
	return out;
}

// ---- asking
const live = [], fakeLog = [], problems = [];
const httpLive = S.createHttp({ fetch: recorder(live) });
const fake = await startFake();
const hosts = S.endpointsFor({ test: true, base: fake.url });
for (const k of Object.keys(hosts)) hosts[k].gap = 0;
const httpFake = S.createHttp({ fetch: recorder(fakeLog), hosts });
const side = (http) => ({ at: S.animeThemes(http, S.createCache()), al: S.aniList(http, S.createCache()), it: S.iTunes(http, S.createCache()), oe: S.oEmbed(http, S.createCache()), http });
const real = side(httpLive), mock = side(httpFake);
const now = S.seasonAt(Date.now());
let nestedNote = '';

async function step(name, fn) {
	try { await fn(); } catch (e) { problems.push(name + ': ' + (e && e.message)); }
}
try {
	fake.set({ atPageSize: 2 });
	await step('AnimeThemes (real)', async () => {
		const found = await real.at.search('sakura');
		if (found.anime[0]) await real.at.anime(found.anime[0].slug);
		if (found.series[0]) {
			const slug = found.series[0].slug;
			await real.http.get('animethemes', '/series/' + encodeURIComponent(slug), { query: { include: 'anime' } });
			const nested = await real.http.get('animethemes', '/series/' + encodeURIComponent(slug), { query: { include: 'anime.animethemes.song.artists' } }).then(() => 200, (e) => e.status || e.code);
			nestedNote = nested === 422 ? 'the nested include on /series is still refused (422); series() reads each anime on its own' : 'the nested include on /series answered ' + nested + ': series() will use one request where it is taken';
		}
		if (found.artists[0]) await real.at.artist(found.artists[0].slug);
		await real.at.season(now.year, now.season);
	});
	await step('AnimeThemes (fake)', async () => {
		await mock.at.search('e');
		await mock.at.anime('lumen_tide');
		await mock.http.get('animethemes', '/series/lumen_tide', { query: { include: 'anime' } });
		await mock.at.artist('aoi_minato');
		await mock.at.season(2026, 'fall');
	});
	await step('AniList (real)', () => real.al.season(now.year, now.season, { perPage: 3 }));
	await step('AniList (fake)', () => mock.al.season(2026, 'fall', { perPage: 3 }));
	await step('iTunes (real)', async () => {
		const artists = await real.it.searchArtist('Yoko Kanno');
		if (!artists[0]) throw new Error('the artist search found nobody');
		const albums = await real.it.albums(artists[0].id, { country: artists[0].country });
		if (albums[0]) await real.it.albumTracks(albums[0].id, { country: artists[0].country });
	});
	await step('iTunes (fake)', async () => {
		await mock.it.searchArtist('Aoi Minato');
		await mock.it.albums(1700000001);
		await mock.it.albumTracks(1710000003);
	});
	await step('YouTube oEmbed (real)', () => real.oe.video('M7lc1UVf-VE').then((r) => { if (!r.ok) throw new Error('the sample video gave ' + r.reason); }));
	await step('YouTube oEmbed (fake)', () => mock.oe.video('fakeS000001'));
} finally {
	await fake.close();
}

// ---- comparing
const ok = (e) => e.status >= 200 && e.status < 300 && e.json !== undefined;
const routes = [...new Set(live.filter(ok).map((e) => e.route).concat(Object.keys(REQUIRED)))];
let failed = problems.length;
console.log('Checked ' + new Date().toISOString() + ': ' + live.length + ' real answers, ' + fakeLog.length + ' from the fake.\n');
for (const p of problems) console.log('FAIL  could not ask ' + p);
for (const route of routes) {
	const a = live.filter((e) => ok(e) && e.route === route).map((e) => e.json);
	const b = fakeLog.filter((e) => ok(e) && e.route === route).map((e) => e.json);
	if (!a.length || !b.length) {
		if (REQUIRED[route]) { failed++; console.log('FAIL  ' + route + ': no answer from ' + (!a.length ? 'the real source' : 'the fake')); }
		continue;
	}
	const c = compare(route, a, b);
	failed += c.fail.length ? 1 : 0;
	console.log((c.fail.length ? 'FAIL  ' : 'ok    ') + route + (c.fail.length ? '' : ' (' + (REQUIRED[route] || []).length + ' keys read by sources.js are there)'));
	for (const f of c.fail) console.log('        changed: ' + f);
	if (c.unseen.length) console.log('        not seen this time (what holds them was empty): ' + c.unseen.join(', '));
	if (c.liveOnly.length) console.log('        only in the real answer: ' + c.liveOnly.slice(0, 12).join(', ') + (c.liveOnly.length > 12 ? ', and ' + (c.liveOnly.length - 12) + ' more' : ''));
	if (c.fakeOnly.length) console.log('        only in the fake: ' + c.fakeOnly.slice(0, 12).join(', ') + (c.fakeOnly.length > 12 ? ', and ' + (c.fakeOnly.length - 12) + ' more' : ''));
}
if (nestedNote) console.log('\nnote  ' + nestedNote);
console.log(failed ? '\n' + failed + ' FAILED: the real answers have changed shape (or could not be read). Update sources.js, then the fixtures.' : '\nThe fixtures are shaped like the real answers.');
process.exit(failed ? 1 : 0);
