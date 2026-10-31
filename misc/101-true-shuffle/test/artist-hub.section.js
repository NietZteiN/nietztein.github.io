module.exports = function (h) {
	var L = require('../library.js'), H = require('../artist-hub.js');
	h.describe('artist-hub', function () {
		var lib = L.create(); L.upsert(lib, [{ id: 'one', title: 'Band - Song', channel: 'Band - Topic' }, { id: 'two', title: 'One & Two - Together', channel: 'One & Two - Topic' }, { id: 'three', title: 'Hero (CV: Voice) - Story', channel: 'Hero - Topic' }]);
		L.edit(lib, 'one', { artist: 'Band', title: 'Song' }); L.edit(lib, 'two', { artist: 'One & Two', title: 'Together' }); L.edit(lib, 'three', { artist: 'Hero (CV: Voice)', title: 'Story' });
		h.eq(H.subject(lib, L, L.normArtist('Band')).tracks.map(function (t) { return t.id; }), ['one'], 'Artist hub starts from the whole library');
		h.eq(H.subject(lib, L, L.normArtist('One')).tracks.map(function (t) { return t.id; }), ['two'], 'Individual collaborators retain their credited songs');
		h.eq(H.subject(lib, L, L.normArtist('Voice')).tracks.map(function (t) { return t.id; }), ['three'], 'Voice performers retain character-credit songs');
		h.eq(H.subject(lib, L, L.normArtist('Voice')).name, 'Voice', 'A direct performer address keeps its readable credited name');
		h.eq(H.subject(lib, L, L.normArtist('Hero')).tracks.length, 0, 'Fictional character credits do not become performer catalogs');
		lib.aliases[L.normArtist('Alias')] = 'Band'; h.eq(H.subject(lib, L, L.normArtist('Alias')).name, 'Band', 'Alias links resolve to the canonical artist');
		var q = new URLSearchParams(H.href('Band & Guest', L, 'catalog', { catalog: 'albums' }).split('?')[1]);
		h.eq([q.get('artist'), q.get('tab'), q.get('catalog')], ['Band & Guest', 'catalog', 'albums'], 'Artist tabs keep artist punctuation and catalog intent');
	});
};
