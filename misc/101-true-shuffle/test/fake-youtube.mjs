/*
 * A fake of the Google endpoints True Shuffle talks to, for tests. It runs on
 * 127.0.0.1 only, holds no real data, and every title, artist and id in it is
 * generated here.
 *
 *     node misc/101-true-shuffle/test/fake-youtube.mjs [--port 8791]
 *
 * prints its address and serves until stopped. Open the page on the local
 * test server with ?api=<that address> and it will sign in, list, import and
 * revoke against this instead of Google. In a script:
 *
 *     import { startFake } from './fake-youtube.mjs';
 *     const fake = await startFake();        // { url, port, stats, set(), reset(), close() }
 *
 * What it serves (all with CORS headers; OPTIONS preflights are answered):
 *   GET  /o/oauth2/v2/auth            the OAuth redirect: back to redirect_uri with #access_token=...
 *   POST /revoke                      revokes a token
 *   GET  /youtube/v3/channels         mine=true: the "likes" playlist id
 *   GET  /youtube/v3/playlists        mine=true: 59 playlists, 50 a page
 *   GET  /youtube/v3/playlistItems    50 a page; PL_BIG has 1,230 items
 *   GET  /youtube/v3/videos           up to 50 ids
 *   GET  /youtube/v3/search           type=video or type=playlist, from test/fixtures/youtube-search.json
 *                                     (100 units; videoCategoryId and videoEmbeddable=true are honoured)
 *   A channel's uploads (UU + 22 characters) answers thirty generated videos.
 *   (GET calls also take key=test-api-key instead of a token, except mine=true; another key is "not valid")
 *   POST /youtube/v3/playlistItems    adds a video to a playlist (a token with the write scope only)
 *   DELETE /youtube/v3/playlistItems  ?id=: takes an added item out again
 *   GET  /ws/2/artist                 a fake of MusicBrainz's artist search and lookup
 *   GET  /__stats, POST /__control    what was asked, and the switches below
 *
 * And the free sources of sources.js, from test/fixtures (invented data in the
 * real answers' shapes; test/fixtures-check.mjs compares them with the real ones):
 *   GET  /oembed?url=...&format=json  a video's title and channel: the generated
 *                                     videos and the fixture ones; 401 for one
 *                                     that cannot be embedded (fake0000037, fakeS000004)
 *                                     or is private, 404 for a deleted or unknown id
 *   GET  /animethemes/search          ?q=&fields[search]=&include[song]=
 *   GET  /animethemes/anime/<slug>    ?include=animethemes.song.artists,series,resources,animesynonyms
 *   GET  /animethemes/anime           ?filter[year]=&filter[season]=&page[size]=&page[number]= (links.next)
 *   GET  /animethemes/series/<slug>   ?include=anime (a nested include answers 422, as the real API does)
 *   GET  /animethemes/artist/<slug>   ?include=songs.animethemes.anime,songs.artists
 *   POST /anilist                     the season Page query (Fall 2026 has five anime; other seasons none)
 *   GET  /itunes/search, /itunes/lookup
 *   GET  /lastfm/?method=             track.getsimilar, artist.getsimilar, artist.gettoptracks;
 *                                     error 10 without api_key, error 6 for what it does not know
 * In a test without a server, createSourceFake().fetch answers the same routes
 * in-process (any origin).
 *
 * The playlists: PL_BIG (1,230 items: 1,200 videos, 30 of them listed twice;
 * some deleted, some private, some not embeddable), PL_PRIVATE (private, 37),
 * PL_SMALL (unlisted, 12, all of them also in PL_BIG), PL_EMPTY (0), LL (the
 * liked videos, 180), 55 small generated ones, and PL_FORBIDDEN, which
 * answers 403. Anything else answers 404.
 *
 * Switches (fake.set({...}) or POST /__control with JSON):
 *   quotaAfter: n        after n more units, every call answers 403 quotaExceeded
 *   failNext: n          the next n API calls answer 503
 *   rateLimitNext: n     the next n API calls answer 403 rateLimitExceeded
 *   expireAfter: n       after n more API calls, every token answers 401
 *   deny: true           the sign-in answers error=access_denied
 *   denyWrite: true      a sign-in that asks to write is granted only the read scope
 *   noChannel: true      the account has no YouTube channel
 *   gone: [ids]          these videos are no longer returned by videos.list
 *   shrink: { PL_SMALL: 2 }   the playlist lists that many items fewer
 *   latencyMs: n         every answer waits
 * and for the free sources (host: animethemes, anilist, itunes, lastfm, oembed):
 *   sourceFail: { host: n }    the next n requests answer 503
 *   sourceRate: { host: n }    the next n answer 429 with Retry-After: 1 (iTunes: 403;
 *                              Last.fm: error 29)
 *   atNestedSeries: true       /animethemes/series takes include=anime.animethemes.song.artists
 *   atPageSize: n              the anime listing gives at most n a page (to see links.next)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const WIKI = 'https://en.wikipedia.org/wiki/';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/youtube';

const ARTISTS = ['Paper Lanterns', 'Glass Orchard', 'Hollow Compass', 'Neon Abacus', 'Saffron Circuit', 'Quiet Ferrymen', 'Tin Lighthouse Trio', 'DJ Tessellate', 'Marrow & Pine', 'The Velvet Algorithms', 'Kumori Station', 'Las Polillas Electricas'];
const TOPICS = [['Rock_music'], ['Pop_music'], ['Rock_music'], ['Electronic_music'], ['Electronic_music', 'Pop_music'], ['Country_music'], ['Jazz'], ['Hip_hop_music'], ['Independent_music'], ['Soul_music', 'Rhythm_and_blues'], ['Pop_music', 'Music_of_Asia'], ['Music_of_Latin_America']];
const WORDS_A = ['Blue', 'Paper', 'Quiet', 'Hollow', 'Amber', 'Northern', 'Borrowed', 'Electric', 'Slow', 'Winter', 'Glass', 'Second', 'Copper', 'Late', 'Small', 'Faded', 'Open', 'Salt', 'Midnight', 'Morning'];
const WORDS_B = ['Signal', 'Almanac', 'Harbor', 'Orchard', 'Current', 'Static', 'Kindling', 'Mosaic', 'Crossing', 'Engine', 'Meadow', 'Window', 'Letters', 'Tide', 'Compass', 'Staircase', 'Garden', 'Radio', 'Echo', 'Lighthouse'];

const pad = (n, w) => String(n).padStart(w, '0');
export const videoId = (n) => 'fake' + pad(n, 7);              // eleven characters, plainly not a real id
const numberOf = (id) => (/^fake(\d{7})$/.test(id) ? Number(id.slice(4)) : NaN);
export const isDeleted = (n) => n % 41 === 0;
export const isPrivate = (n) => n % 97 === 0;
export const notEmbeddable = (n) => n % 37 === 0;

// One generated video. The title shapes rotate through the ones parse.js knows.
function makeVideo(n) {
	const artist = ARTISTS[n % ARTISTS.length];
	const title = WORDS_A[(n * 7) % WORDS_A.length] + ' ' + WORDS_B[(n * 3 + Math.floor(n / 20)) % WORDS_B.length] + (n >= 400 ? ' ' + n : '');
	const shape = n % 6;
	let rawTitle, channel;
	if (shape === 0) { rawTitle = title; channel = artist + ' - Topic'; }
	else if (shape === 1) { rawTitle = artist + ' - ' + title + ' (Official Video)'; channel = artist.replace(/[^A-Za-z]/g, '') + 'VEVO'; }
	else if (shape === 2) { rawTitle = artist + ' - ' + title + ' (Live at Red Hollow)'; channel = 'Red Hollow Sessions'; }
	else if (shape === 3) { rawTitle = title + ' / ' + artist; channel = artist + ' Official'; }
	else if (shape === 4) { rawTitle = artist + ' \u300C' + title + '\u300D Music Video'; channel = artist; }
	else { rawTitle = artist + ' - ' + title + ' [Lyrics]'; channel = 'lyric lantern'; }
	const sec = 95 + (n * 37) % 400;
	const year = 2009 + (n % 15);
	return {
		kind: 'youtube#video',
		etag: 'etag-v-' + n,
		id: videoId(n),
		snippet: {
			publishedAt: `${year}-${pad(1 + (n % 12), 2)}-${pad(1 + (n % 27), 2)}T12:00:00Z`,
			channelId: 'UCfake' + pad(Math.abs(hash(channel)) % 100000, 6),
			title: rawTitle,
			description: shape === 0 ? `Provided to YouTube by Sunken Meadow\n\n${title} \u00B7 ${artist}\n\nReleased on: ${1970 + (n % 50)}-03-0${1 + (n % 9)}\n\nAuto-generated by YouTube.` : 'An invented description.',
			thumbnails: { default: { url: 'https://i.ytimg.com/vi/' + videoId(n) + '/default.jpg', width: 120, height: 90 } },
			channelTitle: channel,
			tags: ['invented', artist.toLowerCase()],
			categoryId: '10',
			liveBroadcastContent: 'none'
		},
		contentDetails: { duration: `PT${Math.floor(sec / 60)}M${sec % 60}S`, dimension: '2d', definition: 'hd', caption: 'false', licensedContent: false, projection: 'rectangular' },
		status: { uploadStatus: 'processed', privacyStatus: 'public', license: 'youtube', embeddable: !notEmbeddable(n), publicStatsViewable: true, madeForKids: false },
		topicDetails: { topicCategories: TOPICS[n % TOPICS.length].map((t) => WIKI + t).concat([WIKI + 'Music']) }
	};
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

function range(from, count) { return Array.from({ length: count }, (_, i) => from + i); }

function buildPlaylists() {
	const big = range(1, 1200);
	// thirty videos sit in the big playlist twice
	for (let i = 0; i < 30; i++) big.splice(100 + i * 37, 0, 5 + i * 11);
	const lists = {
		PL_BIG: { title: 'Everything since 2009', privacy: 'public', items: big },
		PL_PRIVATE: { title: 'Private drafts', privacy: 'private', items: range(2000, 37) },
		PL_SMALL: { title: 'Short list', privacy: 'unlisted', items: range(1, 12) },
		PL_EMPTY: { title: 'Nothing yet', privacy: 'public', items: [] },
		LL: { title: 'Liked videos', privacy: 'private', items: range(3000, 120).concat(range(900, 60)), hidden: true },
		PL_FORBIDDEN: { title: 'Not yours', privacy: 'private', items: range(1, 3), hidden: true, forbidden: true }
	};
	for (let i = 1; i <= 55; i++) lists['PL_GEN_' + pad(i, 2)] = { title: 'Generated list ' + i, privacy: 'public', items: range(4000 + i * 3, 3) };
	return lists;
}

const MB_ARTISTS = {
	'paper lanterns': { id: '00000000-0000-4000-8000-000000000001', name: 'Paper Lanterns', genres: [['indie rock', 9], ['dream pop', 5], ['shoegaze', 2], ['rock', 1]] },
	'glass orchard': { id: '00000000-0000-4000-8000-000000000002', name: 'Glass Orchard', genres: [['synth-pop', 4]] },
	'tin lighthouse trio': { id: '00000000-0000-4000-8000-000000000003', name: 'Tin Lighthouse Trio', genres: [] },
	'the velvet algorithms': { id: '00000000-0000-4000-8000-000000000004', name: 'The Velvet Algorithms', aliases: ['Velvet Algorithms'], genres: [['soul', 7], ['funk', 6]] }
};

function googleError(code, reason, message, domain) {
	return { error: { code, message, errors: [{ message, domain: domain || 'youtube.api', reason }], status: code === 401 ? 'UNAUTHENTICATED' : undefined } };
}

// =============================================================================
// The free sources (sources.js), answered from test/fixtures
// =============================================================================

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export function loadFixtures(dir = FIXTURES) {
	const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
	return { animethemes: read('animethemes.json'), anilist: read('anilist-season.json'), itunes: read('itunes.json'), lastfm: read('lastfm.json'), youtube: read('youtube-search.json') };
}
const pick = (o, keys) => { const out = {}; for (const k of keys) if (o[k] !== undefined) out[k] = o[k]; return out; };
const SOURCE_PATHS = /^\/(animethemes|anilist|itunes|lastfm|oembed)(\/|$)/;

// A videos.list item for a video of youtube-search.json.
function fixtureVideo(fx, id) {
	const s = fx.youtube.videos.find((v) => v.id.videoId === id), d = fx.youtube.details[id];
	if (!s || !d) return null;
	const sn = s.snippet;
	return {
		kind: 'youtube#video', etag: 'etag-v-' + id, id,
		snippet: { publishedAt: sn.publishedAt, channelId: sn.channelId, title: sn.title, description: sn.description, thumbnails: sn.thumbnails, channelTitle: sn.channelTitle, tags: ['invented'], categoryId: d.categoryId, liveBroadcastContent: 'none' },
		contentDetails: { duration: d.duration, dimension: '2d', definition: 'hd', caption: 'false', licensedContent: false, projection: 'rectangular' },
		status: { uploadStatus: 'processed', privacyStatus: 'public', license: 'youtube', embeddable: d.embeddable !== false, publicStatsViewable: true, madeForKids: false },
		topicDetails: { topicCategories: [WIKI + 'Music'] }
	};
}

// The AnimeThemes records, with the indexes the routes need.
function animeThemesDb(data) {
	const anime = data.anime.slice().sort((a, b) => a.id - b.id);
	const bySlug = new Map(anime.map((a) => [a.slug, a]));
	const songs = new Map(), artists = new Map(), series = new Map();
	for (const a of anime) {
		for (const t of a.animethemes) {
			if (!t.song) continue;
			const s = songs.get(t.song.id) || { song: t.song, uses: [] };
			s.uses.push({ theme: t, anime: a });
			songs.set(t.song.id, s);
		}
		for (const s of a.series || []) {
			const e = series.get(s.slug) || { series: s, anime: [] };
			e.anime.push(a);
			series.set(s.slug, e);
		}
	}
	for (const s of songs.values()) {
		for (const x of s.song.artists) {
			const e = artists.get(x.slug) || { artist: pick(x, ['id', 'name', 'slug', 'information']), songs: [] };
			if (!e.songs.some((y) => y.song.id === s.song.id)) e.songs.push({ song: s.song, pivot: x.artistsong });
			artists.set(x.slug, e);
		}
	}
	return { anime, bySlug, songs, artists, series };
}

// One fake for the five sources. answer(method, url, body, origin) -> { status, body, headers }
// or null for a path that is not theirs; fetch(url, init) is the same as a fetch.
export function createSourceFake(options = {}) {
	const fx = options.fixtures || loadFixtures();
	const db = animeThemesDb(fx.animethemes);
	const fresh = () => ({ sourceFail: {}, sourceRate: {}, atNestedSeries: false, atPageSize: 0 });
	let sw = fresh();
	const stats = { requests: 0, byHost: {}, log: [] };
	const KEYS = ['sourceFail', 'sourceRate', 'atNestedSeries', 'atPageSize'];
	function set(changes = {}) {
		if (changes.reset) sw = fresh();
		for (const k of KEYS) if (k in changes) sw[k] = typeof changes[k] === 'object' && changes[k] ? Object.assign({}, changes[k]) : changes[k];
	}
	set(options.switches || {});

	const json = (status, body, headers) => ({ status, body, headers: headers || {} });
	const text = (status, body, headers) => ({ status, body: String(body), headers: headers || {} });
	const invalidInclude = () => json(422, { message: 'The selected include is invalid.', errors: { include: ['The selected include is invalid.'] } });
	const notFound = () => json(404, { message: 'Not Found' });

	// ---- AnimeThemes
	const includes = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
	const has = (inc, rel) => inc.some((p) => p === rel || p.startsWith(rel + '.'));
	const under = (inc, rel) => inc.filter((p) => p.startsWith(rel + '.')).map((p) => p.slice(rel.length + 1));
	const allowed = (inc, ok) => inc.every((p) => ok.includes(p));
	const ANIME_INCLUDES = ['animethemes', 'animethemes.song', 'animethemes.song.artists', 'series', 'resources', 'animesynonyms'];
	function animeOut(a, inc) {
		const o = pick(a, ['id', 'name', 'media_format', 'season', 'slug', 'synopsis', 'year']);
		if (has(inc, 'animethemes')) o.animethemes = a.animethemes.map((t) => themeOut(t, a, under(inc, 'animethemes')));
		if (has(inc, 'resources')) o.resources = a.resources;
		if (has(inc, 'series')) o.series = a.series;
		if (has(inc, 'animesynonyms')) o.animesynonyms = a.animesynonyms;
		return o;
	}
	function themeOut(t, a, inc) {
		const o = pick(t, ['id', 'sequence', 'slug', 'type']);
		if (has(inc, 'song')) o.song = t.song ? songOut(t.song, under(inc, 'song')) : null;
		if (has(inc, 'anime')) o.anime = animeOut(a, under(inc, 'anime'));
		return o;
	}
	function songOut(s, inc) {
		const o = pick(s, ['id', 'title']);
		if (has(inc, 'animethemes')) o.animethemes = (db.songs.get(s.id) || { uses: [] }).uses.map((u) => themeOut(u.theme, u.anime, under(inc, 'animethemes')));
		if (has(inc, 'artists')) o.artists = s.artists;
		return o;
	}
	function animethemes(url, origin) {
		const p = url.searchParams, route = url.pathname.replace(/^\/animethemes/, '');
		let m;
		if (route === '/search') {
			const q = (p.get('q') || '').toLowerCase().trim(), hit = (s) => String(s || '').toLowerCase().includes(q);
			const fields = (p.get('fields[search]') || 'anime,artists,series,songs').split(',').map((s) => s.trim());
			const incSong = includes(p.get('include[song]'));
			if (!allowed(incSong, ['artists', 'animethemes', 'animethemes.anime'])) return invalidInclude();
			const out = {};
			if (fields.includes('anime')) out.anime = db.anime.filter((a) => hit(a.name) || a.animesynonyms.some((s) => hit(s.text))).map((a) => animeOut(a, []));
			if (fields.includes('artists')) out.artists = [...db.artists.values()].filter((e) => hit(e.artist.name)).map((e) => e.artist);
			if (fields.includes('series')) out.series = [...db.series.values()].filter((e) => hit(e.series.name)).map((e) => e.series);
			if (fields.includes('songs')) out.songs = [...db.songs.values()].filter((e) => hit(e.song.title)).map((e) => songOut(e.song, incSong));
			return json(200, { search: out });
		}
		if ((m = /^\/anime\/([^/]+)$/.exec(route))) {
			const inc = includes(p.get('include'));
			if (!allowed(inc, ANIME_INCLUDES)) return invalidInclude();
			const a = db.bySlug.get(decodeURIComponent(m[1]));
			return a ? json(200, { anime: animeOut(a, inc) }) : notFound();
		}
		if (route === '/anime') {
			const inc = includes(p.get('include'));
			if (!allowed(inc, ANIME_INCLUDES)) return invalidInclude();
			const year = p.get('filter[year]'), season = (p.get('filter[season]') || '').toLowerCase();
			const list = db.anime.filter((a) => (!year || String(a.year) === year) && (!season || a.season.toLowerCase() === season));
			let size = Math.max(1, Math.min(100, Number(p.get('page[size]')) || 15));
			if (sw.atPageSize > 0) size = Math.min(size, sw.atPageSize);
			const number = Math.max(1, Number(p.get('page[number]')) || 1), from = (number - 1) * size, slice = list.slice(from, from + size);
			const pageUrl = (n) => { const u = new URL(origin + url.pathname + url.search); u.searchParams.set('page[number]', String(n)); return u.toString(); };
			return json(200, {
				anime: slice.map((a) => animeOut(a, inc)),
				links: { first: pageUrl(1), last: null, prev: number > 1 ? pageUrl(number - 1) : null, next: from + size < list.length ? pageUrl(number + 1) : null },
				meta: { current_page: number, current_page_url: pageUrl(number), from: slice.length ? from + 1 : null, path: origin + url.pathname, per_page: size, to: slice.length ? from + slice.length : null }
			});
		}
		if ((m = /^\/series\/([^/]+)$/.exec(route))) {
			const inc = includes(p.get('include'));
			const ok = ['anime'].concat(sw.atNestedSeries ? ['anime.animethemes', 'anime.animethemes.song', 'anime.animethemes.song.artists'] : []);
			if (!allowed(inc, ok)) return invalidInclude();
			const e = db.series.get(decodeURIComponent(m[1]));
			if (!e) return notFound();
			const o = pick(e.series, ['id', 'name', 'slug']);
			if (has(inc, 'anime')) o.anime = e.anime.map((a) => animeOut(a, under(inc, 'anime')));
			return json(200, { series: o });
		}
		if ((m = /^\/artist\/([^/]+)$/.exec(route))) {
			const inc = includes(p.get('include'));
			if (!allowed(inc, ['songs', 'songs.animethemes', 'songs.animethemes.anime', 'songs.artists'])) return invalidInclude();
			const e = db.artists.get(decodeURIComponent(m[1]));
			if (!e) return notFound();
			const o = Object.assign({}, e.artist);
			if (has(inc, 'songs')) o.songs = e.songs.map((x) => Object.assign(songOut(x.song, under(inc, 'songs')), { artistsong: x.pivot }));
			return json(200, { artist: o });
		}
		return notFound();
	}

	// ---- AniList
	function anilist(method, body) {
		if (method !== 'POST') return json(400, { errors: [{ message: 'Send the query by POST.', status: 400 }], data: null });
		let q;
		try { q = JSON.parse(body || ''); } catch { return json(400, { errors: [{ message: 'Invalid JSON', status: 400 }], data: null }); }
		const v = q.variables || {};
		if (!/Page\s*\(/.test(q.query || '') || !/media\s*\(/.test(q.query || '') || !v.season || !v.year) return json(400, { errors: [{ message: 'The fake answers only the season query.', status: 400 }], data: null });
		const f = fx.anilist, per = Math.max(1, Math.min(50, Number(v.perPage) || 50));
		const media = String(v.season).toUpperCase() === f.season && Number(v.year) === f.year ? f.response.data.Page.media.slice().sort((a, b) => b.popularity - a.popularity).slice(0, per) : [];
		return json(200, { data: { Page: { media } } });
	}

	// ---- iTunes (Apple answers text/javascript, with blank lines first)
	function itunes(url) {
		const p = url.searchParams, all = fx.itunes.results;
		const reply = (results) => text(200, '\n\n\n' + JSON.stringify({ resultCount: results.length, results }) + '\n', { 'Content-Type': 'text/javascript; charset=utf-8' });
		const limit = Math.max(1, Math.min(200, Number(p.get('limit')) || 50));
		if (url.pathname === '/itunes/search') {
			const words = (p.get('term') || '').toLowerCase().split(/\s+/).filter(Boolean), entity = p.get('entity') || 'musicTrack';
			const hit = (...s) => words.length && words.every((w) => s.join(' ').toLowerCase().includes(w));
			let out = [];
			if (entity === 'musicArtist') out = all.filter((r) => r.wrapperType === 'artist' && hit(r.artistName));
			else if (entity === 'album') out = all.filter((r) => r.wrapperType === 'collection' && hit(r.collectionName, r.artistName));
			else out = all.filter((r) => r.wrapperType === 'track' && hit(r.trackName, r.artistName));
			return reply(out.slice(0, limit));
		}
		if (url.pathname === '/itunes/lookup') {
			const ids = (p.get('id') || '').split(',').map(Number).filter(Boolean), entity = p.get('entity') || '';
			let out = [];
			for (const id of ids) {
				const artist = all.find((r) => r.wrapperType === 'artist' && r.artistId === id);
				const coll = all.find((r) => r.wrapperType === 'collection' && r.collectionId === id);
				if (artist) {
					out.push(artist);
					if (entity === 'album') out = out.concat(all.filter((r) => r.wrapperType === 'collection' && r.artistId === id).slice(0, limit));
					if (entity === 'song') out = out.concat(all.filter((r) => r.wrapperType === 'track' && r.artistId === id).slice(0, limit));
				} else if (coll) {
					out.push(coll);
					if (entity === 'song') out = out.concat(all.filter((r) => r.wrapperType === 'track' && r.collectionId === id).sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber));
				}
			}
			return reply(out);
		}
		return text(404, 'Not Found');
	}

	// ---- Last.fm
	function lastfm(url) {
		const p = url.searchParams, method = (p.get('method') || '').toLowerCase();
		if (!p.get('api_key')) return json(403, { message: 'Invalid API key - You must be granted a valid key by last.fm', error: 10 });
		const table = fx.lastfm[method];
		if (!table) return json(400, { message: 'Invalid Method - No method with that name in this package', error: 3 });
		const artist = (p.get('artist') || '').toLowerCase().trim(), key = method === 'track.getsimilar' ? artist + '|' + (p.get('track') || '').toLowerCase().trim() : artist;
		const found = table[key];
		if (!found) return json(200, { message: method === 'track.getsimilar' ? 'Track not found' : 'The artist you supplied could not be found', error: 6, links: [] });
		const limit = Number(p.get('limit')) || 0, copy = JSON.parse(JSON.stringify(found)), top = copy[Object.keys(copy)[0]];
		for (const k of Object.keys(top)) if (Array.isArray(top[k]) && limit > 0) top[k] = top[k].slice(0, limit);
		return json(200, copy);
	}

	// ---- YouTube oEmbed
	function oembed(url) {
		let id = '';
		try {
			const v = new URL(url.searchParams.get('url') || '');
			id = v.hostname === 'youtu.be' ? v.pathname.slice(1) : v.searchParams.get('v') || '';
		} catch { return text(400, 'Bad Request'); }
		let title, channel, channelId, topic;
		const s = fx.youtube.videos.find((x) => x.id.videoId === id), n = numberOf(id);
		if (s) {
			if (fx.youtube.details[id] && fx.youtube.details[id].embeddable === false) return text(401, 'Unauthorized');
			title = s.snippet.title; channel = s.snippet.channelTitle; channelId = s.snippet.channelId; topic = / - Topic$/.test(channel);
		} else if (!Number.isNaN(n) && n > 0) {
			if (isDeleted(n)) return text(404, 'Not Found');
			if (isPrivate(n) || notEmbeddable(n)) return text(401, 'Unauthorized');
			const v = makeVideo(n);
			title = v.snippet.title; channel = v.snippet.channelTitle; channelId = v.snippet.channelId; topic = n % 6 === 0;
		} else return text(404, 'Not Found');
		const author = topic ? 'https://www.youtube.com/channel/' + channelId : 'https://www.youtube.com/@' + channel.replace(/[^A-Za-z0-9]+/g, '');
		return json(200, {
			title, author_name: channel, author_url: author, type: 'video', height: 113, width: 200, version: '1.0',
			provider_name: 'YouTube', provider_url: 'https://www.youtube.com/', thumbnail_height: 360, thumbnail_width: 480,
			thumbnail_url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
			html: '<iframe width="200" height="113" src="https://www.youtube.com/embed/' + id + '?feature=oembed" frameborder="0" allowfullscreen title="' + title.replace(/"/g, '&quot;') + '"></iframe>'
		});
	}

	function answer(method, url, body, origin) {
		const m = SOURCE_PATHS.exec(url.pathname);
		if (!m) return null;
		const host = m[1];
		stats.requests++;
		stats.byHost[host] = (stats.byHost[host] || 0) + 1;
		stats.log.push(host + ' ' + method + ' ' + url.pathname + url.search);
		if (sw.sourceFail[host] > 0) { sw.sourceFail[host]--; return json(503, { message: 'Service Unavailable' }); }
		if (sw.sourceRate[host] > 0) {
			sw.sourceRate[host]--;
			if (host === 'itunes') return text(403, '');
			if (host === 'lastfm') return json(429, { message: 'Rate Limit Exceeded - Your IP has made too many requests in a short period', error: 29 });
			return json(429, { message: 'Too Many Attempts.' }, { 'Retry-After': '1' });
		}
		if (host === 'animethemes') return method === 'GET' ? animethemes(url, origin || url.origin) : json(405, { message: 'Method Not Allowed' });
		if (host === 'anilist') return anilist(method, body);
		if (host === 'itunes') return itunes(url);
		if (host === 'lastfm') return lastfm(url);
		return oembed(url);
	}

	// The same answers as a fetch, for tests without a server.
	async function fetchLike(input, init = {}) {
		if (init.signal && init.signal.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
		const url = new URL(String(input));
		const r = answer(String(init.method || 'GET').toUpperCase(), url, typeof init.body === 'string' ? init.body : '', url.origin) || text(404, 'Not found: ' + url.pathname);
		const bodyText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
		const headers = Object.assign({ 'content-type': typeof r.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }, Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v])));
		return {
			ok: r.status >= 200 && r.status < 300, status: r.status, url: url.toString(),
			headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
			text: async () => bodyText,
			json: async () => JSON.parse(bodyText)
		};
	}

	return {
		fixtures: fx, stats, answer, fetch: fetchLike, set,
		reset() { sw = fresh(); stats.requests = 0; stats.byHost = {}; stats.log = []; }
	};
}

export async function startFake(options = {}) {
	const fx = loadFixtures();
	const src = createSourceFake({ fixtures: fx });
	const playlists = buildPlaylists();
	// the albums and playlists of youtube-search.json, listed by playlistItems
	for (const [id, items] of Object.entries(fx.youtube.lists)) {
		const found = fx.youtube.playlists.find((pl) => pl.id.playlistId === id);
		playlists[id] = { title: found ? found.snippet.title : id, privacy: 'public', items: items.slice(), hidden: true };
	}
	let tokenSerial = 0;
	const tokens = new Map();      // token -> { revoked, write }
	const fresh = () => ({ quotaAfter: null, failNext: 0, rateLimitNext: 0, expireAfter: null, deny: false, denyWrite: false, noChannel: false, gone: [], shrink: {}, latencyMs: 0 });
	let itemSerial = 0;
	let sw = Object.assign(fresh(), options.switches || {});
	const stats = { requests: 0, units: 0, byMethod: {}, auth: 0, revoked: [], preflights: 0, mb: 0, log: [] };

	function send(res, status, body, headers = {}) {
		const text = typeof body === 'string' ? body : JSON.stringify(body);
		res.writeHead(status, Object.assign({
			'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'no-store'
		}, headers));
		res.end(text);
	}
	function itemsOf(id) {
		const p = playlists[id];
		const cut = sw.shrink && sw.shrink[id] ? sw.shrink[id] : 0;
		return cut ? p.items.slice(0, Math.max(0, p.items.length - cut)) : p.items;
	}
	function page(list, params, defaultSize) {
		const size = Math.max(1, Math.min(50, Number(params.get('maxResults')) || defaultSize));
		let offset = 0;
		const tok = params.get('pageToken');
		if (tok) {
			const m = /^o:(\d+)$/.exec(Buffer.from(tok, 'base64url').toString('utf8'));
			if (!m || Number(m[1]) > list.length) return { error: googleError(400, 'invalidPageToken', 'The request specifies an invalid page token.', 'youtube.parameter') };
			offset = Number(m[1]);
		}
		const slice = list.slice(offset, offset + size), next = offset + size;
		return {
			slice, offset,
			nextPageToken: next < list.length ? Buffer.from('o:' + next).toString('base64url') : undefined,
			pageInfo: { totalResults: list.length, resultsPerPage: size }
		};
	}

	function api(req, res, url) {
		const method = url.pathname.replace('/youtube/v3/', '') + '.list';
		const p = url.searchParams;
		stats.requests++;
		stats.units += method === 'search.list' ? 100 : 1;
		stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
		stats.log.push(method + (p.get('pageToken') ? ' page' : '') + (p.get('playlistId') ? ' ' + p.get('playlistId') : ''));

		// who is asking
		const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
		const tok = auth && tokens.get(auth[1]);
		if (sw.expireAfter != null) { if (sw.expireAfter <= 0) return send(res, 401, googleError(401, 'authError', 'Invalid Credentials', 'global')); sw.expireAfter--; }
		const apiKey = p.get('key');
		if (!tok && apiKey && apiKey !== 'test-api-key') return send(res, 400, googleError(400, 'badRequest', 'API key not valid. Please pass a valid API key.', 'global'));
		if (!tok && apiKey && p.get('mine') === 'true') return send(res, 401, googleError(401, 'required', 'Login Required.', 'global'));
		if ((!tok || tok.revoked) && apiKey !== 'test-api-key') return send(res, 401, googleError(401, 'authError', 'Invalid Credentials', 'global'));
		if (sw.failNext > 0) { sw.failNext--; return send(res, 503, googleError(503, 'backendError', 'Backend Error', 'global')); }
		if (sw.rateLimitNext > 0) { sw.rateLimitNext--; return send(res, 403, googleError(403, 'rateLimitExceeded', 'Rate Limit Exceeded', 'usageLimits')); }
		if (sw.quotaAfter != null) {
			if (sw.quotaAfter <= 0) return send(res, 403, googleError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.', 'youtube.quota'));
			sw.quotaAfter--;
		}

		if (method === 'channels.list') {
			if (p.get('mine') !== 'true') return send(res, 400, googleError(400, 'missingRequiredParameter', 'No filter selected.'));
			if (sw.noChannel) return send(res, 200, { kind: 'youtube#channelListResponse', pageInfo: { totalResults: 0, resultsPerPage: 5 } });
			return send(res, 200, {
				kind: 'youtube#channelListResponse', pageInfo: { totalResults: 1, resultsPerPage: 5 },
				items: [{ kind: 'youtube#channel', id: 'UCfakelistener', snippet: { title: 'Fake Listener' }, contentDetails: { relatedPlaylists: { likes: 'LL', uploads: 'UUfakelistener' } } }]
			});
		}
		if (method === 'playlists.list') {
			if (p.get('mine') !== 'true') return send(res, 400, googleError(400, 'missingRequiredParameter', 'No filter selected.'));
			const ids = Object.keys(playlists).filter((id) => !playlists[id].hidden);
			const pg = page(ids, p, 5);
			if (pg.error) return send(res, 400, pg.error);
			return send(res, 200, {
				kind: 'youtube#playlistListResponse', nextPageToken: pg.nextPageToken, pageInfo: pg.pageInfo,
				items: pg.slice.map((id) => ({
					kind: 'youtube#playlist', id,
					snippet: { publishedAt: '2019-05-01T10:00:00Z', channelId: 'UCfakelistener', title: playlists[id].title, description: '', channelTitle: 'Fake Listener', thumbnails: {} },
					status: { privacyStatus: playlists[id].privacy },
					contentDetails: { itemCount: itemsOf(id).length }
				}))
			});
		}
		if (method === 'playlistItems.list') {
			const id = p.get('playlistId');
			// a channel's uploads (UU + the channel id after UC): thirty generated videos
			if (id && /^UU[A-Za-z0-9_-]{22}$/.test(id) && !playlists[id]) playlists[id] = { title: 'Uploads', privacy: 'public', items: range(5000 + (Math.abs(hash(id)) % 500), 30), hidden: true };
			if (!id || !playlists[id]) return send(res, 404, googleError(404, 'playlistNotFound', 'The playlist identified with the request\'s playlistId parameter cannot be found.', 'youtube.playlistItem'));
			if (playlists[id].forbidden) return send(res, 403, googleError(403, 'playlistItemsNotAccessible', 'The request is not properly authorized to retrieve the specified playlist.', 'youtube.playlistItem'));
			const pg = page(itemsOf(id), p, 5);
			if (pg.error) return send(res, 400, pg.error);
			return send(res, 200, {
				kind: 'youtube#playlistItemListResponse', nextPageToken: pg.nextPageToken, pageInfo: pg.pageInfo,
				items: pg.slice.map((n, i) => {
					// an item is a generated video's number, or a fixture video's id
					const fixture = typeof n === 'string', vid = fixture ? n : videoId(n), priv = !fixture && isPrivate(n);
					const gone = fixture ? sw.gone.includes(vid) : isDeleted(n) || priv || sw.gone.includes(vid), v = fixture ? fixtureVideo(fx, n) : makeVideo(n);
					const position = pg.offset + i;
					const added = new Date(Date.UTC(2020, 0, 1) + position * 86400000 / 2).toISOString();
					const item = {
						kind: 'youtube#playlistItem', id: 'PLI-' + id + '-' + position,
						snippet: {
							publishedAt: added, channelId: 'UCfakelistener', channelTitle: 'Fake Listener', playlistId: id, position,
							title: priv ? 'Private video' : gone ? 'Deleted video' : v.snippet.title,
							description: priv ? 'This video is private.' : gone ? 'This video is unavailable.' : '',
							thumbnails: {}, resourceId: { kind: 'youtube#video', videoId: vid }
						},
						contentDetails: { videoId: vid },
						status: { privacyStatus: priv ? 'private' : gone ? 'privacyStatusUnspecified' : 'public' }
					};
					if (!gone) {
						item.snippet.videoOwnerChannelTitle = v.snippet.channelTitle;
						item.snippet.videoOwnerChannelId = v.snippet.channelId;
						item.contentDetails.videoPublishedAt = v.snippet.publishedAt;
					}
					return item;
				})
			});
		}
		if (method === 'videos.list') {
			const ids = (p.get('id') || '').split(',').filter(Boolean);
			if (!ids.length) return send(res, 400, googleError(400, 'missingRequiredParameter', 'No filter selected.'));
			if (ids.length > 50) return send(res, 400, googleError(400, 'invalidFilters', 'The request specifies too many ids.', 'youtube.parameter'));
			const items = ids.map((id) => {
				if (fx.youtube.details[id]) return sw.gone.includes(id) ? null : fixtureVideo(fx, id);
				const n = numberOf(id);
				return !Number.isNaN(n) && n > 0 && !isDeleted(n) && !isPrivate(n) && !sw.gone.includes(videoId(n)) ? makeVideo(n) : null;
			}).filter(Boolean);
			return send(res, 200, { kind: 'youtube#videoListResponse', items, pageInfo: { totalResults: items.length, resultsPerPage: items.length } });
		}
		if (method === 'search.list') {
			// the fixtures' videos and playlists whose title or channel holds every word of q
			const types = (p.get('type') || 'video,channel,playlist').split(','), words = (p.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
			const hit = (sn) => words.length > 0 && words.every((w) => (sn.title + ' ' + sn.channelTitle).toLowerCase().includes(w));
			const size = Math.max(0, Math.min(50, p.get('maxResults') == null ? 5 : Number(p.get('maxResults'))));
			const category = p.get('videoCategoryId'), embeddable = p.get('videoEmbeddable') === 'true';
			let items = [];
			if (types.includes('video')) items = items.concat(fx.youtube.videos.filter((v) => { const d = fx.youtube.details[v.id.videoId] || {}; return hit(v.snippet) && (!category || d.categoryId === category) && (!embeddable || d.embeddable !== false); }));
			if (types.includes('playlist')) items = items.concat(fx.youtube.playlists.filter((pl) => hit(pl.snippet)));
			return send(res, 200, { kind: 'youtube#searchListResponse', etag: 'etag-search', regionCode: 'US', pageInfo: { totalResults: items.length, resultsPerPage: size }, items: items.slice(0, size) });
		}
		return send(res, 404, googleError(404, 'notFound', 'Not Found', 'global'));
	}

	// playlistItems.insert and .delete, 50 units each
	function writeItem(req, res, url, body) {
		const method = 'playlistItems.' + (req.method === 'POST' ? 'insert' : 'delete');
		stats.requests++;
		stats.units += 50;
		stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
		stats.log.push(method);
		const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
		const tok = auth && tokens.get(auth[1]);
		if (!tok || tok.revoked) return send(res, 401, googleError(401, 'authError', 'Invalid Credentials', 'global'));
		if (!tok.write) return send(res, 403, googleError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.', 'global'));
		if (sw.quotaAfter != null) {
			if (sw.quotaAfter <= 0) return send(res, 403, googleError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.', 'youtube.quota'));
			sw.quotaAfter--;
		}
		if (req.method === 'DELETE') {
			const m = /^PLI-(.+)-(\d+)$/.exec(url.searchParams.get('id') || '');
			const list = m && playlists[m[1]];
			if (!list || Number(m[2]) >= list.items.length) return send(res, 404, googleError(404, 'playlistItemNotFound', 'Playlist item not found.', 'youtube.playlistItem'));
			list.items.splice(Number(m[2]), 1);
			res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
			return res.end();
		}
		let data;
		try { data = JSON.parse(body || '{}'); } catch { return send(res, 400, googleError(400, 'parseError', 'Parse Error', 'global')); }
		const sn = data.snippet || {}, id = sn.playlistId, vid = sn.resourceId && sn.resourceId.videoId;
		if (url.searchParams.get('part') !== 'snippet') return send(res, 400, googleError(400, 'missingRequiredParameter', 'No part parameter.', 'youtube.parameter'));
		if (!id || !playlists[id] || playlists[id].forbidden) return send(res, 404, googleError(404, 'playlistNotFound', 'Playlist not found.', 'youtube.playlistItem'));
		const n = numberOf(vid || '');
		if (Number.isNaN(n) || n <= 0 || isDeleted(n) || isPrivate(n) || sw.gone.includes(vid)) return send(res, 404, googleError(404, 'videoNotFound', 'Video not found.', 'youtube.playlistItem'));
		const list = playlists[id];
		list.items.push(n);
		const position = list.items.length - 1;
		itemSerial++;
		return send(res, 200, {
			kind: 'youtube#playlistItem', id: 'PLI-' + id + '-' + position,
			snippet: { publishedAt: new Date(Date.UTC(2026, 9, 9, 12, 0, itemSerial)).toISOString(), channelId: 'UCfakelistener', playlistId: id, position, title: makeVideo(n).snippet.title, resourceId: { kind: 'youtube#video', videoId: vid } }
		});
	}

	function musicbrainz(res, url) {
		stats.mb++;
		const m = /^\/ws\/2\/artist\/([0-9a-f-]{36})$/.exec(url.pathname);
		if (m) {
			const a = Object.values(MB_ARTISTS).find((x) => x.id === m[1]);
			if (!a) return send(res, 404, { error: 'Not Found' });
			return send(res, 200, { id: a.id, name: a.name, genres: a.genres.map(([name, count]) => ({ name, count, id: 'g-' + name })) });
		}
		const q = url.searchParams.get('query') || '';
		const name = (/artist:"((?:[^"\\]|\\.)*)"/.exec(q) || [])[1];
		// Like the real search, forgiving about case and a leading "The".
		const norm = (s) => s.toLowerCase().replace(/^the\s+/, '');
		const key = name ? norm(name.replace(/\\(.)/g, '$1')) : '';
		const a = Object.values(MB_ARTISTS).find((x) => norm(x.name) === key || (x.aliases || []).some((al) => norm(al) === key));
		const artists = a ? [{ id: a.id, name: a.name, score: 100, aliases: (a.aliases || []).map((n) => ({ name: n })) }] : [{ id: '00000000-0000-4000-8000-00000000ffff', name: 'Somebody Else Entirely', score: 61 }];
		return send(res, 200, { created: '2026-10-05T00:00:00.000Z', count: artists.length, offset: 0, artists });
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		const go = () => {
			try {
				if (req.method === 'OPTIONS') {
					stats.preflights++;
					res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Max-Age': '600' });
					return res.end();
				}
				if (url.pathname === '/o/oauth2/v2/auth') {
					stats.auth++;
					const q = url.searchParams, back = q.get('redirect_uri') || '';
					let target;
					try { target = new URL(back); } catch { return send(res, 400, 'Error 400: invalid_request (redirect_uri)'); }
					if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) return send(res, 400, 'Error 400: redirect_uri_mismatch (the fake only sends tokens to localhost)');
					if (q.get('response_type') !== 'token') return send(res, 400, 'Error 400: unsupported_response_type');
					if (!q.get('client_id')) return send(res, 400, 'Error 401: invalid_client');
					const asked = String(q.get('scope') || '').split(/ +/).filter(Boolean);
					if (!asked.length || asked.some((s) => s !== SCOPE && s !== WRITE_SCOPE)) return send(res, 400, 'Error 400: invalid_scope');
					const write = asked.includes(WRITE_SCOPE) && !sw.denyWrite;
					// include_granted_scopes: the read scope comes along with the write one
					const granted = write ? [SCOPE, WRITE_SCOPE] : [SCOPE];
					const state = q.get('state') || '';
					let frag;
					if (sw.deny) frag = new URLSearchParams({ error: 'access_denied', state });
					else {
						const token = 'fake-token-' + (++tokenSerial);
						tokens.set(token, { revoked: false, write });
						frag = new URLSearchParams({ state, access_token: token, token_type: 'Bearer', expires_in: '3599', scope: granted.join(' ') });
					}
					res.writeHead(302, { Location: back.split('#')[0] + '#' + frag.toString(), 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
					return res.end();
				}
				if (url.pathname === '/revoke' && req.method === 'POST') {
					let body = '';
					req.on('data', (c) => { body += c; });
					req.on('end', () => {
						const token = new URLSearchParams(body).get('token') || url.searchParams.get('token');
						const t = tokens.get(token);
						if (!t || t.revoked) return send(res, 400, { error: 'invalid_token' });
						t.revoked = true;
						stats.revoked.push(token);
						send(res, 200, {});
					});
					return undefined;
				}
				if (url.pathname.startsWith('/youtube/v3/') && req.method === 'GET') return api(req, res, url);
				if (url.pathname === '/youtube/v3/playlistItems' && (req.method === 'POST' || req.method === 'DELETE')) {
					let body = '';
					req.on('data', (c) => { body += c; });
					req.on('end', () => writeItem(req, res, url, body));
					return undefined;
				}
				if (url.pathname.startsWith('/ws/2/artist') && req.method === 'GET') return musicbrainz(res, url);
				if (SOURCE_PATHS.test(url.pathname)) {
					let body = '';
					req.on('data', (c) => { body += c; });
					req.on('end', () => {
						const r = src.answer(req.method, url, body, 'http://' + (req.headers.host || '127.0.0.1'));
						send(res, r.status, r.body, r.headers);
					});
					return undefined;
				}
				if (url.pathname === '/__stats') return send(res, 200, stats);
				if (url.pathname === '/__control' && req.method === 'POST') {
					let body = '';
					req.on('data', (c) => { body += c; });
					req.on('end', () => {
						try { handle.set(JSON.parse(body || '{}')); send(res, 200, { ok: true }); }
						catch (e) { send(res, 400, { ok: false, error: String(e && e.message) }); }
					});
					return undefined;
				}
				return send(res, 404, 'Not found: ' + url.pathname);
			} catch (e) {
				return send(res, 500, 'fake server error: ' + (e && e.stack));
			}
		};
		if (sw.latencyMs > 0) setTimeout(go, sw.latencyMs); else go();
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port || 0, '127.0.0.1', resolve);
	});
	const port = server.address().port;
	stats.sources = src.stats;
	const handle = {
		url: 'http://127.0.0.1:' + port,
		port,
		stats,
		playlists,
		// the free sources' fake (its switches go through set() too)
		sources: src,
		// A token as the sign-in would issue it, without going through the redirect.
		issueToken(o = {}) { const t = 'fake-token-' + (++tokenSerial); tokens.set(t, { revoked: false, write: !!o.write }); return t; },
		set(changes) { if (changes && changes.reset) sw = fresh(); Object.assign(sw, changes || {}); delete sw.reset; src.set(changes || {}); return handle; },
		reset() { sw = fresh(); stats.requests = 0; stats.units = 0; stats.byMethod = {}; stats.auth = 0; stats.preflights = 0; stats.mb = 0; stats.log = []; stats.revoked = []; src.reset(); stats.sources = src.stats; return handle; },
		close() { return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }); }
	};
	return handle;
}

// Run directly: serve until stopped.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const at = process.argv.indexOf('--port');
	const fake = await startFake({ port: at > 0 ? Number(process.argv[at + 1]) : 0 });
	console.log(fake.url);
}
