// channel: a YouTube channel as a place to find music (channel.js).
module.exports = function (h) {
	var path = require('path');
	var Ch = require(path.join(h.HERE, 'channel.js'));
	var S = require(path.join(h.HERE, 'shuffle.js'));

	function t(id, channel, channelId, artist, guess, added) {
		return { id: id, channel: channel, channelId: channelId, artist: artist || '', guess: guess ? { artist: guess[0], rule: guess[1] } : { artist: '', rule: 'none' }, addedAt: added || { pl: '2026-01-01T00:00:00Z' } };
	}
	var WOUND = 'UCwound00000000000000000', NEON = 'UCneon000000000000000000';

	h.describe('channel', async function () {
		// ---- rank: the library's channels, the ones that find music first ----
		var lib = [
			t('a1', 'wound', WOUND, '', ['Moth Radio', 'dash'], { pl: '2026-02-01T00:00:00Z', other: '2026-05-01T00:00:00Z' }),
			t('a2', 'wound', WOUND, '', ['Copper Sea', 'dash']),
			t('a3', 'wound', WOUND, 'Lantern Choir'),
			t('a4', 'wound', WOUND, '', ['Moth Radio', 'dash']),
			t('b1', 'Neon Abacus Official', NEON, 'Neon Abacus'),
			t('b2', 'Neon Abacus Official', NEON, 'Neon Abacus'),
			t('b3', 'Neon Abacus Official', NEON, 'Neon Abacus'),
			t('c1', 'Paper Lanterns - Topic', 'UCtopic', 'Paper Lanterns'),
			t('c2', 'Paper Lanterns - Topic', 'UCtopic', 'Paper Lanterns'),
			t('d1', 'GlassOrchardVEVO', 'UCvevo', 'Glass Orchard'),
			t('d2', 'GlassOrchardVEVO', 'UCvevo', 'Glass Orchard'),
			t('e1', 'cassette drawer', 'UCcassette', '', ['Hollow Compass', 'dash']),
			t('e2', 'cassette drawer', 'UCcassette', '', ['Hollow Compass', 'dash']),
			t('f1', 'one-off uploads', 'UConeoff', '', ['Velvet Kites', 'dash']),
			t('g1', 'Marrow & Pine', 'UCmarrow', 'Marrow & Pine'),
			t('g2', 'Marrow & Pine', 'UCmarrow', 'Marrow & Pine'),
			{ id: 'z1', channel: 'nowhere', channelId: '', artist: 'X' }
		];
		var r = Ch.rank(lib), by = {};
		r.forEach(function (c) { by[c.id] = c; });
		h.eq(r.slice(0, 2).map(function (c) { return c.name; }), ['wound', 'cassette drawer'], 'rank: channels that upload other artists come first, the most artists first');
		h.eq([by[WOUND].curator, by[WOUND].songs, by[WOUND].artists, by[WOUND].names], [true, 4, 3, ['Moth Radio', 'Copper Sea', 'Lantern Choir']], 'rank: a curator, its songs and its artists (guessed ones too), the most frequent first');
		h.eq([by[NEON].curator, by.UCtopic.curator, by.UCvevo.curator, by.UCmarrow.curator], [false, false, false, false], 'rank: an artist\'s own channel is not a curator (Official, Topic, VEVO, the artist\'s name)');
		h.eq([by.UCcassette.curator, by.UCcassette.artists], [true, 1], 'rank: a channel that only uploads someone else\'s songs is one, even with one artist so far');
		h.eq(by.UConeoff.curator, false, 'rank: one song is not enough to tell');
		h.eq(by[WOUND].lastAdded, '2026-05-01T00:00:00Z', 'rank: the latest a song was added');
		h.eq(by[WOUND].ids, ['a1', 'a2', 'a3', 'a4'], 'rank: the songs\' ids');
		h.ok(!r.some(function (c) { return c.name === 'nowhere'; }), 'rank: songs with no channel id are left out');
		h.eq(Ch.rank({ x: lib[0], y: lib[1] })[0].songs, 2, 'rank: takes a map of tracks too');

		// ---- isMusic: what Play and Shuffle leave out ----
		h.eq([
			Ch.isMusic('Moth Radio - Blue Ferry (Official Audio)'), Ch.isMusic('Moth Radio - Blue Ferry #shorts'), Ch.isMusic('Album trailer'),
			Ch.isMusic('Livestream archive 2026-03-01'), Ch.isMusic('studio vlog #3'), Ch.isMusic('Moth Radio - Blue Ferry', 32), Ch.isMusic('Moth Radio - Blue Ferry', 214), Ch.isMusic('')
		], [true, false, false, false, false, false, true, true], 'isMusic: shorts, trailers, streams, vlogs and very short uploads are not songs');
		h.eq([Ch.isMusic('A message from Rick #rickastley', 0, false), Ch.isMusic('Copenhagen, you were amazing #tour #live', 0, false), Ch.isMusic('Moth Radio - Blue Ferry #citypop', 0, true), Ch.isMusic('Blue Ferry #citypop')], [false, false, true, true], 'isMusic: hashtags with no artist read from the title are a Short or an announcement');

		// ---- uploadFinds: uploads as finds, the artist read from the title ----
		var items = [
			{ videoId: 'vidAAAAAAA1', title: 'Moth Radio - Blue Ferry', channel: 'wound', channelId: WOUND, addedAt: '2026-09-01T00:00:00Z' },
			{ videoId: 'vidAAAAAAA1', title: 'Moth Radio - Blue Ferry', channel: 'wound' },
			{ videoId: 'vidAAAAAAA2', title: 'Copper Sea - Night Signal [HD]', channel: 'wound' },
			{ videoId: 'vidAAAAAAA3', title: 'Lantern Choir - Paper Garden (teaser)', channel: 'wound' },
			{ videoId: 'vidAAAAAAA4', title: 'Gone', unavailable: true },
			{ videoId: 'vidAAAAAAA5', title: '', channel: 'wound' },
			{ title: 'no id' }
		];
		var fs0 = Ch.uploadFinds(items, { channelId: WOUND, channel: 'wound', have: function (id) { return id === 'vidAAAAAAA2'; } });
		h.eq(fs0.map(function (f) { return f.videoId; }), ['vidAAAAAAA1', 'vidAAAAAAA2', 'vidAAAAAAA3', 'vidAAAAAAA5'], 'uploadFinds: each video once, the unavailable and id-less ones dropped');
		h.eq([fs0[0].key, fs0[0].artist, fs0[0].title, fs0[0].sure, fs0[0].source, fs0[0].channelId, fs0[0].addedAt], ['v:vidAAAAAAA1', 'Moth Radio', 'Blue Ferry', false, 'ytuploads', WOUND, '2026-09-01T00:00:00Z'], 'uploadFinds: the artist and title read from "Artist - Title", a guess on a stranger\'s channel');
		h.eq([fs0[1].title, fs0[1].mine, fs0[0].mine, fs0[2].music, fs0[0].music], ['Night Signal', true, false, false, true], 'uploadFinds: junk tags dropped from titles, the library\'s videos marked, a teaser is not a song');
		h.eq([fs0[3].title, fs0[3].artist, fs0[3].raw], ['', '', ''], 'uploadFinds: an upload whose title is not known yet');
		var ruled = Ch.uploadFinds(items.slice(0, 1), { channel: 'wound', rule: 'artist-title' });
		h.eq([ruled[0].artist, ruled[0].sure], ['Moth Radio', true], 'uploadFinds: with the channel\'s rule the artist is sure');
		var made = Ch.uploadFinds(items.slice(0, 1), { find: function (f) { return { wrapped: f.key }; } });
		h.eq(made, [{ wrapped: 'v:vidAAAAAAA1' }], 'uploadFinds: each one through the find maker (sources.js find)');

		// ---- artistsOf ----
		var arts = Ch.artistsOf([{ artist: 'Moth Radio' }, { artist: 'moth radio' }, { artist: 'Moth Radio' }, { artist: 'Copper Sea' }, { artist: '' }, null]);
		h.eq(arts, [{ key: 'mothradio', name: 'Moth Radio', count: 3 }, { key: 'coppersea', name: 'Copper Sea', count: 1 }], 'artistsOf: grouped across spellings, the commonest spelling, the most frequent first');

		// ---- teachRule ----
		h.eq(Ch.teachRule(lib.slice(0, 4)), 'artist-title', 'teachRule: unsure songs titled "Artist - Title"');
		h.eq(Ch.teachRule([t('s1', 'aozora', 'UCa', '', ['Mizuiro Parade', 'slash-guess']), t('s2', 'aozora', 'UCa', '', ['Mizuiro Parade', 'slash-guess'])]), 'title-artist', 'teachRule: "Title / Artist"');
		h.eq(Ch.teachRule([t('m1', 'x', 'UCx', '', ['A', 'dash']), t('m2', 'x', 'UCx', '', ['B', 'slash-guess']), t('m3', 'x', 'UCx', '', ['C', 'known-artist'])]), null, 'teachRule: no shape that most of them keep');
		h.eq(Ch.teachRule([t('o1', 'x', 'UCx', '', ['A', 'dash'])]), null, 'teachRule: one song is not enough');
		h.eq(Ch.teachRule([t('p1', 'x', 'UCx', 'Sure Artist'), t('p2', 'x', 'UCx', 'Sure Artist')]), null, 'teachRule: nothing to teach when the artists are sure');
		h.eq([fs0[0].shape, fs0[1].shape], ['dash', 'dash'], 'uploadFinds: the shape parse.js read in each title');
		h.eq(Ch.teachRule(fs0), 'artist-title', 'teachRule: uploads alone can show the shape (the library\'s copy and untitled ones aside)');
		h.eq(Ch.teachRule(Ch.uploadFinds(items, { channel: 'wound', rule: 'artist-title' })), null, 'teachRule: nothing to teach once the channel has its rule');

		// ---- demoUploads ----
		var d1 = Ch.demoUploads('demo-ch-x', 'cassette drawer', S.rng('channel-demo')), d2 = Ch.demoUploads('demo-ch-x', 'cassette drawer', S.rng('channel-demo'));
		h.eq(d1, d2, 'demoUploads: the same channel and seed, the same uploads');
		h.ok(d1.length === 18 && d1.every(function (u) { return /^[A-Za-z0-9_-]{11}$/.test(u.videoId) && u.channel === 'cassette drawer' && u.channelId === 'demo-ch-x'; }), 'demoUploads: eighteen, with ids shaped like YouTube\'s');
		h.ok(d1.every(function (u, i) { return i === 0 || u.addedAt < d1[i - 1].addedAt; }), 'demoUploads: the newest first');
		h.ok(Ch.artistsOf(Ch.uploadFinds(d1, {})).length >= 4, 'demoUploads: by several artists');

		// ---- readList: a visible player reads a list's ids ----
		function fakeYT(script) {
			var made = [];
			function Player(slot, opts) { var self = this; this.slot = slot; this.opts = opts; this.cued = []; this.destroyed = false; this.paused = 0; made.push(this); setTimeout(function () { opts.events.onReady({ target: self }); }, 1); }
			Player.prototype.getPlaylist = function () { return script(this); };
			Player.prototype.cuePlaylist = function (o) { this.cued.push(o); };
			Player.prototype.destroy = function () { this.destroyed = true; };
			Player.prototype.pauseVideo = function () { this.paused++; };
			return { YT: { Player: Player }, made: made };
		}
		function fakeBox() { var box = { kids: [], appendChild: function (n) { n.parentNode = box; box.kids.push(n); }, removeChild: function (n) { n.parentNode = null; box.kids = box.kids.filter(function (k) { return k !== n; }); } }; return box; }
		var doc = { createElement: function () { return { parentNode: null }; } };
		var quick = { pollMs: 2, retryMs: 20, timeoutMs: 3000, doc: doc };
		// the first item cannot be embedded: empty until cued from the next one
		var f1 = fakeYT(function (p) { return p.cued.length ? ['vidBBBBBBB1', 'vidBBBBBBB2', 'not an id', 'vidBBBBBBB3'] : []; }), box1 = fakeBox();
		var ids1 = await Ch.readList(box1, 'UUwound', Object.assign({ loadApi: function () { return Promise.resolve(f1.YT); } }, quick));
		var p1 = f1.made[0];
		h.eq(ids1, ['vidBBBBBBB1', 'vidBBBBBBB2', 'vidBBBBBBB3'], 'readList: the ids, once the list reads');
		h.eq([p1.opts.playerVars.list, p1.opts.playerVars.listType, p1.opts.host, p1.opts.width, p1.opts.height], ['UUwound', 'playlist', 'https://www.youtube-nocookie.com', 356, 200], 'readList: a visible 356 by 200 player on youtube-nocookie, given the list');
		h.eq(p1.cued, [{ listType: 'playlist', list: 'UUwound', index: 1 }], 'readList: an empty read is cued again from the next item');
		h.eq([p1.destroyed, box1.kids.length], [true, 0], 'readList: the player is gone once the list is read');
		p1.opts.events.onStateChange({ data: 1 });
		h.eq(p1.paused, 1, 'readList: a press on its play is undone (it only reads)');
		var f2 = fakeYT(function () { return []; });
		var ids2 = await Ch.readList(fakeBox(), 'UUnothing', Object.assign({ loadApi: function () { return Promise.resolve(f2.YT); }, retries: 2 }, quick));
		h.eq([ids2, f2.made[0].cued.length, f2.made[0].destroyed], [[], 2, true], 'readList: a list that never reads gives none after the retries');
		await h.rejects(Ch.readList(fakeBox(), 'UUx', Object.assign({}, quick, { loadApi: function () { return Promise.reject(new Error('blocked')); } })), null, 'readList: the player cannot load: rejects');
		var f3 = fakeYT(function () { return null; });
		await h.rejects(Ch.readList(fakeBox(), 'UUslow', Object.assign({}, quick, { loadApi: function () { return Promise.resolve(f3.YT); }, retryMs: 100000, timeoutMs: 40 })), null, 'readList: no answer in time: rejects');
		h.ok(f3.made[0].destroyed, 'readList: and the player is gone then too');
		await h.rejects(Ch.readList(null, 'UUx', { loadApi: function () { return Promise.resolve(f1.YT); }, doc: doc }), null, 'readList: no box: rejects');
	});
};
