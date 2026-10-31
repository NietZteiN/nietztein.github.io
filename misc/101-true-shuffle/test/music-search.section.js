module.exports = function (h) {
	var S = require('../music-search.js'), Src = require('../sources.js');
	h.describe('music-search', function () {
		h.eq(S.state(new URLSearchParams('q=Sound&kind=surprise&scope=discover&run=1')), { query: 'Sound', discover: true, kind: 'all', run: true }, 'Unknown result types fall back to all without changing the query');
		h.eq(S.state(new URLSearchParams('scope=unknown')), { query: '', discover: false, kind: 'all', run: false }, 'Unknown scopes keep the safe library default');
		var state = S.state(new URLSearchParams('q=A%26B&scope=discover&kind=albums&run=1'));
		h.eq(S.searchHref(state, { run: false }), '#/search?q=A%26B&scope=discover&kind=albums', 'Editing a catalog query drops submitted state and retains result type');
		h.eq(S.searchHref(state, { discover: false }), '#/search?q=A%26B', 'Returning to the library cannot carry external request state');
		var songs = S.songsFrom({ results: [
			{ wrapperType: 'artist', artistId: 1 },
			{ wrapperType: 'track', kind: 'music-video', trackId: 4 },
			{ wrapperType: 'track', kind: 'song', trackId: 5, trackName: '<Signal>', artistName: 'Band & One', collectionId: 9, trackTimeMillis: 182500, artworkUrl100: 'javascript:bad', previewUrl: 'file:///bad' },
			{ wrapperType: 'track', kind: 'song', trackId: 6, trackName: 'Valid', artistName: 'Band', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Test/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/test.m4a' }
		] }, Src);
		h.eq(songs.length, 2, 'Typed song search excludes artists, music videos and malformed results');
		h.eq([songs[0].title, songs[0].artist, songs[0].durationSec, songs[0].albumId], ['<Signal>', 'Band & One', 183, 'it:9'], 'Song metadata retains plain text and normalizes duration and album identity');
		h.eq([songs[0].cover, songs[0].preview], ['', ''], 'Unsafe external artwork and audio URLs are discarded');
		h.ok(songs[1].cover.indexOf('/300x300bb.jpg') >= 0, 'Approved Apple artwork uses the existing larger size');
		h.eq(S.songsFrom(null, Src), [], 'A malformed catalog response has no song results');
		var original = { id: 7, title: 'Signal', date: '2026-03-04', type: 'EP' }, album = S.albumShape(original);
		h.eq([album.key, album.source, album.year, album.type, album.ids.itunes], ['it:album:7', 'itunes', 2026, 'ep', 7], 'Search releases use the same identity and type as artist catalogs');
		h.eq(original, { id: 7, title: 'Signal', date: '2026-03-04', type: 'EP' }, 'Normalizing a release never mutates the cached provider response');
	});
};
