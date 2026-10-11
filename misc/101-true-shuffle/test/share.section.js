// share: a queue as a link, a pasted list as songs.
module.exports = function (h) {
	var path = require('path');
	var Sh = require(path.join(h.HERE, 'share.js'));

	h.describe('share', async function () {
		var link = Sh.link(['dQw4w9WgXcQ', 'not-an-id', 'dQw4w9WgXcQ', 'aaaaaaaaaaa'], 'Late night & rain', 'https://x.test/misc/101-true-shuffle/');
		h.eq(link, 'https://x.test/misc/101-true-shuffle/#/share?ids=dQw4w9WgXcQ.aaaaaaaaaaa&t=Late%20night%20%26%20rain', 'link: valid ids once each, the title escaped');
		var back = Sh.decode(new URLSearchParams(link.split('?')[1]));
		h.eq(back, { ids: ['dQw4w9WgXcQ', 'aaaaaaaaaaa'], title: 'Late night & rain', start: null }, 'decode: the same songs and title, and no start');

		// where to start: the song and the second (handoff.js's "Continue on your phone")
		function q(l) { return new URLSearchParams(l.split('?')[1]); }
		var three = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
		var at = Sh.link(three, 'Late night & rain', 'https://x.test/', { id: 'bbbbbbbbbbb', sec: 151.9 });
		h.eq(at, 'https://x.test/#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc&at=bbbbbbbbbbb&s=151&t=Late%20night%20%26%20rain', 'link: the start song and whole seconds, before the title');
		h.eq(Sh.decode(q(at)), { ids: three, title: 'Late night & rain', start: { id: 'bbbbbbbbbbb', index: 1, sec: 151 } }, 'decode: the start comes back, with its place in the list');
		h.eq(Sh.link(three, '', '', { id: 'aaaaaaaaaaa', sec: 0.6 }), '#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc&at=aaaaaaaaaaa', 'link: under a second is the beginning: the song only');
		h.eq(Sh.link(three, '', '', { id: 'zzzzzzzzzzz', sec: 40 }), '#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc', 'link: a start that is not among the songs is left out');
		h.eq([Sh.decode(q('#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb&at=bbbbbbbbbbb')).start, Sh.decode(q('#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb&s=75')).start], [{ id: 'bbbbbbbbbbb', index: 1, sec: 0 }, { id: 'aaaaaaaaaaa', index: 0, sec: 75 }], 'decode: a song without seconds starts at its beginning; seconds without a song are the first song\'s');
		h.eq([Sh.decode(q('#/share?ids=aaaaaaaaaaa&at=zzzzzzzzzzz&s=75')).start, Sh.decode(q('#/share?ids=aaaaaaaaaaa&at=<b>&s=75')).start, Sh.decode(q('#/share?ids=aaaaaaaaaaa&s=-4')).start, Sh.decode(q('#/share?ids=aaaaaaaaaaa&s=1e9')).start, Sh.decode(q('#/share?at=aaaaaaaaaaa&s=5')).start], [null, null, null, null, null], 'decode: a start song not in the list, not an id, odd seconds or no songs: no start');
		var emoji = String.fromCharCode(0xD83C, 0xDFB5), long = new Array(120).join('a') + emoji;
		h.eq(Sh.decode(q(Sh.link(three, long))).title, new Array(120).join('a'), 'link: a title cut at 120 never splits a character in two (encodeURIComponent would throw)');
		h.eq([Sh.startIn(Sh.decode(q(at)), three), Sh.startIn(Sh.decode(q(at)), ['aaaaaaaaaaa', 'ccccccccccc']), Sh.startIn(Sh.decode(q(at)), ['aaaaaaaaaaa']), Sh.startIn(back, ['dQw4w9WgXcQ'])], [{ k: 1, sec: 151, exact: true }, { k: 1, sec: 0, exact: false }, null, null], 'startIn: the start song; when it is gone the next one from its beginning; none after it, or no start: null');

		// the second is reached with a seek once the start song plays
		var P = require(path.join(h.HERE, 'player.js')), mock = P.create({ kind: 'mock', auto: false });
		var stop = Sh.seekOnPlay(mock, 'bbbbbbbbbbb', 151);
		mock.load('aaaaaaaaaaa');
		await Promise.resolve(); await Promise.resolve();
		h.eq([mock.id(), mock.state(), mock.time().current], ['aaaaaaaaaaa', 'playing', 0], 'seekOnPlay: another song playing first is left alone');
		mock.load('bbbbbbbbbbb');
		await Promise.resolve(); await Promise.resolve();
		h.eq([mock.id(), mock.time().current], ['bbbbbbbbbbb', 151], 'seekOnPlay: the start song goes to its second once it plays');
		mock.load('bbbbbbbbbbb');
		await Promise.resolve(); await Promise.resolve();
		h.eq(mock.time().current, 0, 'seekOnPlay: once only (a replay starts at the beginning)');
		stop();
		var stop2 = Sh.seekOnPlay(mock, 'ccccccccccc', 30);
		stop2();
		mock.load('ccccccccccc');
		await Promise.resolve(); await Promise.resolve();
		h.eq(mock.time().current, 0, 'seekOnPlay: stopped before the song plays, it does nothing');
		h.eq(typeof Sh.seekOnPlay(mock, 'ccccccccccc', 0), 'function', 'seekOnPlay: no second, nothing to wait for');
		mock.destroy();
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
