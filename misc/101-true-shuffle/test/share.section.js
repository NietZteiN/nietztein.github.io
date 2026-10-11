// share: a queue as a link, a pasted list as songs.
module.exports = function (h) {
	var path = require('path');
	var Sh = require(path.join(h.HERE, 'share.js'));

	h.describe('share', async function () {
		var link = Sh.link(['dQw4w9WgXcQ', 'not-an-id', 'dQw4w9WgXcQ', 'aaaaaaaaaaa'], 'Late night & rain', 'https://x.test/misc/101-true-shuffle/');
		h.eq(link, 'https://x.test/misc/101-true-shuffle/#/share?ids=dQw4w9WgXcQ.aaaaaaaaaaa&t=Late%20night%20%26%20rain', 'link: valid ids once each, the title escaped');
		var back = Sh.decode(new URLSearchParams(link.split('?')[1]));
		h.eq(back, { ids: ['dQw4w9WgXcQ', 'aaaaaaaaaaa'], title: 'Late night & rain' }, 'decode: the same songs and title');
		var many = []; for (var i = 0; i < 150; i++) many.push(('id' + i + '_________').slice(0, 11));
		h.eq(Sh.decode(new URLSearchParams(Sh.link(many, '').split('?')[1])).ids.length, Sh.MAX, 'link: at most ' + Sh.MAX + ' songs');
		h.eq(Sh.decode(new URLSearchParams('ids=<script>.x&t=')).ids, [], 'decode: anything that is not a video id is dropped');
		h.eq([Sh.videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), Sh.videoIdOf('https://youtu.be/dQw4w9WgXcQ'), Sh.videoIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ'), Sh.videoIdOf('dQw4w9WgXcQ'), Sh.videoIdOf('hello')], ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', ''], 'videoIdOf: links of every shape, and bare ids');
		var dash = String.fromCharCode(0x2013), slash = String.fromCharCode(0xFF0F), dot = String.fromCharCode(0x2022);
		var list = Sh.parseList('1. Paper Lanterns - Blue Signal\n\n' + dot + ' Glass Orchard ' + dash + ' Winter Almanac\nCounting Backwards / Neon Abacus\nMosaic' + slash + 'Tin Lighthouse Trio\nHarbour Lights by Tin Lighthouse Trio\nhttps://youtu.be/dQw4w9WgXcQ\nJust A Title');
		h.eq(list.map(function (x) { return x.videoId || (x.artist + '|' + x.title); }), ['Paper Lanterns|Blue Signal', 'Glass Orchard|Winter Almanac', 'Neon Abacus|Counting Backwards', 'Tin Lighthouse Trio|Mosaic', 'Tin Lighthouse Trio|Harbour Lights', 'dQw4w9WgXcQ', '|Just A Title'], 'parseList: dashes, slashes, "by", links, numbering and bullets');
		var asked = [];
		Sh.configure({ fetch: function (url) {
			asked.push(url);
			var id = /v%3D([A-Za-z0-9_-]{11})/.exec(url)[1];
			if (id === 'bbbbbbbbbbb') return Promise.resolve({ ok: false, status: 401, json: function () { return Promise.resolve({}); } });
			return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ title: 'Song ' + id.slice(0, 3), author_name: 'Channel ' + id.slice(0, 3) }); } });
		} });
		var t = await Sh.titles(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
		h.eq([t.aaaaaaaaaaa.title, t.bbbbbbbbbbb, t.ccccccccccc.channel], ['Song aaa', null, 'Channel ccc'], 'titles: oEmbed for each, null for one that cannot be played on other sites');
		h.ok(asked.every(function (u) { return u.indexOf('https://www.youtube.com/oembed?url=') === 0 && /format=json$/.test(u); }), 'titles: asks YouTube\'s oEmbed only');
	});
};
