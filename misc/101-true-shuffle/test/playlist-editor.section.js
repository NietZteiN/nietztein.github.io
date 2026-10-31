'use strict';
module.exports = function (h) {
	h.describe('playlist-editor', function () {
		require('./playlist-editor.test.cjs')();
		h.ok(true, 'All strict ordering, selection, unavailable-ID and merge-safe Undo assertions pass');
	});
};
