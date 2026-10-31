module.exports = function (h) {
	var A = require('../artist-launch.js'), L = require('../library.js');
	h.describe('artist-launch', function () {
		var lib = L.create(); lib.aliases[L.normArtist('Old Name')] = 'New Name';
		h.eq(A.targets({ artist: 'Old Name', feat: ['New Name', 'Guest'], origArtist: 'Origin' }, L, lib).map(function (p) { return p.name; }), ['New Name', 'Guest', 'Origin'], 'Canonical names deduplicate lead and featured artists, keeping the original performer');
		h.eq(A.targets({ artist: 'One & Two', feat: ['Two'] }, L, lib).map(function (p) { return p.name; }), ['One & Two', 'One', 'Two'], 'Ampersand band names retain their confirmed credit while offering individual catalogs');
		h.eq(A.targets({ artist: 'Hero (CV: Voice)' }, L, lib).map(function (p) { return [p.name, p.role]; }), [['Voice', 'Voice performer']], 'Character credits discover the voice performer, not the fictional character');
		h.eq(A.targets({ artist: '', artistGuess: 'Uncertain', channel: 'Uploader', feat: ['Guess'] }, L, lib), [], 'Unknown artists and channels never become confident artist lookups');
		h.eq(A.targets(null, L, lib), [], 'An idle player has no artist shortcuts');
		var name = 'A & B / + ?', q = new URLSearchParams(A.href(name, 'albums', { missing: true }).split('?')[1]);
		h.eq([q.get('artist'), q.get('catalog'), q.get('missing')], [name, 'albums', '1'], 'Punctuation in artist names cannot change the catalog or filter parameters');
	});
};
