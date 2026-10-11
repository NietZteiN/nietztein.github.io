// explore: any song as a door to more music (explore.js), its pure parts.
module.exports = function (h) {
	var path = require('path');
	var X = require(path.join(h.HERE, 'explore.js'));

	h.describe('explore', async function () {
		// ---- parseSeed: the route ----
		h.eq([
			X.parseSeed({ parts: ['explore', 'dQw4w9WgXcQ'] }), X.parseSeed({ parts: ['explore', 'find', 'at:song:12'] }),
			X.parseSeed({ parts: ['explore'] }), X.parseSeed({ parts: ['songs', 'x'] }), X.parseSeed(null)
		], [{ kind: 'track', id: 'dQw4w9WgXcQ' }, { kind: 'find', key: 'at:song:12' }, null, null, null], 'parseSeed: a library song, a found song, nothing');

		// ---- order: the lanes a song has, most specific first ----
		var anime = { kind: 'track', track: { id: 'a' }, videoId: 'a', artist: 'Lia', work: 'Air', channel: 'Key Sounds Label', channelId: 'UCkey', scene: 'anime' };
		h.eq(X.order(anime), ['work', 'mix', 'artist', 'similar', 'channel', 'library'], 'order: an anime song from the library has every lane, its anime first');
		h.eq(X.order({ kind: 'track', track: { id: 'b' }, videoId: 'b', artist: 'Moth Radio', channel: 'Moth Radio - Topic', channelId: 'UCtopic', lang: 'en' }), ['mix', 'artist', 'similar', 'library'], 'order: no anime lane for a song with no work, no channel lane for the artist\'s Topic channel');
		h.eq(X.order({ kind: 'track', track: { id: 'c' }, videoId: 'c', artist: 'Aimer', lang: 'ja' }), ['work', 'mix', 'artist', 'similar', 'library'], 'order: a Japanese song with no scene may be from an anime');
		h.eq(X.order({ kind: 'find', find: { key: 'it:track:1' }, videoId: null, artist: 'Copper Sea', channelId: '' }), ['artist', 'similar'], 'order: a found song not on YouTube yet: no Mix, no library lane');
		h.eq(X.order({ kind: 'find', find: { key: 'v:x' }, videoId: 'x', artist: '', channel: 'wound', channelId: 'UCwound' }), ['mix', 'similar', 'channel'], 'order: no artist lane without an artist');
		h.eq(X.order(null), [], 'order: no seed, no lanes');

		// ---- hrefOf, remember, recall: where exploring a song goes ----
		h.eq(X.hrefOf({ mine: 'lib01234567' }), '#/explore/lib01234567', 'hrefOf: a song the library has goes by its id');
		h.eq(X.hrefOf({ track: { id: 'abc' } }), '#/explore/abc', 'hrefOf: a library track');
		var f = { key: 'at:song:42', title: 'Blue Signal', artist: 'Paper Lanterns', videoId: null };
		h.eq(X.hrefOf(f), '#/explore/find/at%3Asong%3A42', 'hrefOf: a found song goes by its key');
		h.eq(X.recall('at:song:42'), f, 'remember: a found song explored is kept for the session');
		h.eq(X.recall('at:song:43'), null, 'recall: one never seen is not known');
		h.eq(X.trail(), [], 'trail: none outside a browser');
		h.eq(X.LANES, ['work', 'mix', 'artist', 'similar', 'channel', 'library'], 'LANES: the lanes, most specific first');
	});
};
