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
 *   POST /youtube/v3/playlistItems    adds a video to a playlist (a token with the write scope only)
 *   DELETE /youtube/v3/playlistItems  ?id=: takes an added item out again
 *   GET  /ws/2/artist                 a fake of MusicBrainz's artist search and lookup
 *   GET  /__stats, POST /__control    what was asked, and the switches below
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
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

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

export async function startFake(options = {}) {
	const playlists = buildPlaylists();
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
		stats.units++;
		stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
		stats.log.push(method + (p.get('pageToken') ? ' page' : '') + (p.get('playlistId') ? ' ' + p.get('playlistId') : ''));

		// who is asking
		const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
		const tok = auth && tokens.get(auth[1]);
		if (sw.expireAfter != null) { if (sw.expireAfter <= 0) return send(res, 401, googleError(401, 'authError', 'Invalid Credentials', 'global')); sw.expireAfter--; }
		if (!tok || tok.revoked) return send(res, 401, googleError(401, 'authError', 'Invalid Credentials', 'global'));
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
			if (!id || !playlists[id]) return send(res, 404, googleError(404, 'playlistNotFound', 'The playlist identified with the request\'s playlistId parameter cannot be found.', 'youtube.playlistItem'));
			if (playlists[id].forbidden) return send(res, 403, googleError(403, 'playlistItemsNotAccessible', 'The request is not properly authorized to retrieve the specified playlist.', 'youtube.playlistItem'));
			const pg = page(itemsOf(id), p, 5);
			if (pg.error) return send(res, 400, pg.error);
			return send(res, 200, {
				kind: 'youtube#playlistItemListResponse', nextPageToken: pg.nextPageToken, pageInfo: pg.pageInfo,
				items: pg.slice.map((n, i) => {
					const position = pg.offset + i, gone = isDeleted(n) || isPrivate(n) || sw.gone.includes(videoId(n)), v = makeVideo(n);
					const added = new Date(Date.UTC(2020, 0, 1) + position * 86400000 / 2).toISOString();
					const item = {
						kind: 'youtube#playlistItem', id: 'PLI-' + id + '-' + position,
						snippet: {
							publishedAt: added, channelId: 'UCfakelistener', channelTitle: 'Fake Listener', playlistId: id, position,
							title: isPrivate(n) ? 'Private video' : gone ? 'Deleted video' : v.snippet.title,
							description: isPrivate(n) ? 'This video is private.' : gone ? 'This video is unavailable.' : '',
							thumbnails: {}, resourceId: { kind: 'youtube#video', videoId: videoId(n) }
						},
						contentDetails: { videoId: videoId(n) },
						status: { privacyStatus: isPrivate(n) ? 'private' : gone ? 'privacyStatusUnspecified' : 'public' }
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
			const items = ids.map(numberOf).filter((n) => !Number.isNaN(n) && n > 0 && !isDeleted(n) && !isPrivate(n) && !sw.gone.includes(videoId(n))).map(makeVideo);
			return send(res, 200, { kind: 'youtube#videoListResponse', items, pageInfo: { totalResults: items.length, resultsPerPage: items.length } });
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
	const handle = {
		url: 'http://127.0.0.1:' + port,
		port,
		stats,
		playlists,
		// A token as the sign-in would issue it, without going through the redirect.
		issueToken(o = {}) { const t = 'fake-token-' + (++tokenSerial); tokens.set(t, { revoked: false, write: !!o.write }); return t; },
		set(changes) { if (changes && changes.reset) sw = fresh(); Object.assign(sw, changes || {}); delete sw.reset; return handle; },
		reset() { sw = fresh(); stats.requests = 0; stats.units = 0; stats.byMethod = {}; stats.auth = 0; stats.preflights = 0; stats.mb = 0; stats.log = []; stats.revoked = []; return handle; },
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
