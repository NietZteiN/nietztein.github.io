// Home keeps listening first; the wider library is one deliberate step away.
(function (TS) {
	'use strict';
	var unwatch = null;

	function link(ctx, title, sub, href, icon, cls) {
		var h = ctx.h;
		return h('a', { class: 'ts-home-link' + (cls ? ' ' + cls : ''), href: href }, [
			ctx.icon(icon || 'songs'),
			h('span', null, [h('b', { text: title }), h('span', { class: 'ts-muted', text: sub })]),
			ctx.icon('arrow-right')
		]);
	}
	function tracks(view, ctx, title, ids, href, text) {
		var lib = ctx.lib(), kept = ids.filter(function (id) { return !!lib.tracks[id]; });
		if (!kept.length) return;
		ctx.ui.sectionHead(view, title, href ? { href: href, text: text || 'See all' } : null);
		ctx.ui.shelf(view, kept.map(function (id, i) { return ctx.ui.trackCard(lib.tracks[id], kept, i, { label: title, href: href || '#/' }); }));
	}
	function playable(ctx, tracks) {
		return tracks.filter(function (t) { return ctx.L.playable(t) && !t.blocked; });
	}
	function noMusic(view, ctx, home) {
		var h = ctx.h;
		if (home && home.focused && home.focused() && ctx.L.list(ctx.lib()).length) {
			var empty = h('section', { class: 'ts-home-empty' });
			empty.appendChild(h('h1', { class: 'ts-h1', text: 'No music in this playlist yet' }));
			empty.appendChild(h('p', { class: 'ts-muted', text: 'Choose another playlist or return to your full library.' }));
			if (home.clearFocus) empty.appendChild(ctx.U.btn({ label: 'Show everything', variant: 'primary', on: { click: home.clearFocus } }));
			empty.appendChild(h('a', { class: 'ts-home-textlink', href: '#/lists', text: 'Choose a playlist' }));
			view.appendChild(empty); return;
		}
		var box = h('section', { class: 'ts-welcome ts-home-welcome' });
		box.appendChild(h('p', { class: 'ts-home-kicker', text: 'Your music. Your order.' }));
		box.appendChild(h('h1', { class: 'ts-h1', text: 'Turn your playlists into a listening library' }));
		box.appendChild(h('p', { class: 'ts-home-lede', text: 'Bring your YouTube playlists or a saved library file. Find your music by artist, mood or the stories it comes from, then choose how it shuffles.' }));
		var buttons = h('div', { class: 'ts-row-btns' });
		buttons.appendChild(h('a', { class: 'ts-btn ts-btn--primary ts-btn--md', href: '?demo=1', text: 'Try the demo' }));
		buttons.appendChild(h('a', { class: 'ts-btn ts-btn--secondary ts-btn--md', href: '#/settings', text: 'Set up your library' }));
		box.appendChild(buttons);
		box.appendChild(h('p', { class: 'ts-muted ts-home-demo-note', text: 'The demo uses invented songs and a simulated player. It needs no account and contacts no music services.' }));
		var steps = h('ol', { class: 'ts-home-steps' });
		[
			['Bring your music', 'Connect YouTube in Settings or import a library file. You choose which playlists to read.'],
			['Make it yours', 'Browse the artists and titles we find. Correct a label when it needs a little help.'],
			['Press play', 'Start with a daily mix, explore one part of your library, or shuffle everything.']
		].forEach(function (step) { steps.appendChild(h('li', null, [h('b', { text: step[0] }), h('p', { text: step[1] })])); });
		box.appendChild(steps);
		box.appendChild(h('p', { class: 'ts-muted', text: 'Your library and listening history stay in this browser. Settings explains sign-in, music services and backups before you connect.' }));
		view.appendChild(box);
	}
	function searchHandoff(view, ctx, words) {
		var query = String(words || '').trim(), h = ctx.h;
		var box = h('section', { class: 'ts-home-search-handoff' });
		box.appendChild(h('h2', { text: 'Looking beyond your library?' }));
		box.appendChild(h('p', { class: 'ts-muted', text: 'This search looks through the music you have imported. Discover can look up an artist\'s songs and albums.' }));
		box.appendChild(h('a', { class: 'ts-btn ts-btn--secondary ts-btn--md', href: '#/for-you' + (query ? '?artist=' + encodeURIComponent(query) : ''), text: query ? 'Try ' + ctx.words.q(query) + ' as an artist' : 'Choose an artist to discover' }));
		view.appendChild(box);
		return box;
	}
	function view(view, ctx, home) {
		if (unwatch) { unwatch(); unwatch = null; }
		var ix = ctx.idx(), h = ctx.h, W = ctx.words, lib = ctx.lib();
		if (!ix.all.length) { noMusic(view, ctx, home); return; }
		var music = playable(ctx, ix.music), inScope = {};
		music.forEach(function (t) { inScope[t.id] = true; });
		var daily = home.dailyMix(music).filter(function (id) { return !!inScope[id]; });
		var root = h('div', { class: 'ts-home' }); view.appendChild(root);
		var hero = h('section', { class: 'ts-home-hero ts-home-intro' });
		hero.appendChild(h('p', { class: 'ts-home-kicker', text: ctx.demo ? 'Demo library' : 'Your library, on this device' }));
		hero.appendChild(h('h1', { class: 'ts-greet', text: 'Your next listen' }));
		hero.appendChild(h('p', { class: 'ts-muted', text: W.plural(ix.music.length, 'song') + ' ' + W.DOT + ' ' + W.plural(Object.keys(ix.artists).length, 'artist') + (ctx.demo ? ' ' + W.DOT + ' invented music, simulated player' : '') }));
		root.appendChild(hero);

		var current = h('section', { class: 'ts-home-current', hidden: true, aria: { label: 'Continue listening' } });
		var status = h('p', { class: 'ts-home-kicker' }), title = h('h2'), artist = h('p', { class: 'ts-muted' });
		var currentText = h('div', { class: 'ts-home-current-text' }, [status, title, artist]);
		current.appendChild(currentText);
		var continueButton = ctx.U.btn({ label: 'Resume listening', icon: 'play', variant: 'secondary', on: { click: function () {
			var t = ctx.current(); if (!t) return;
			var state = ctx.player() && ctx.player().state();
			if (state === 'playing' || state === 'loading') home.openPlayer();
			else ctx.play.now([t.id]);
		} } });
		continueButton.setAttribute('data-home-continue', ''); current.appendChild(continueButton); root.appendChild(current);
		function updateCurrent() {
			if (!root.isConnected) { if (unwatch) { unwatch(); unwatch = null; } return; }
			var t = ctx.current(), state = ctx.player() && ctx.player().state(), playing = state === 'playing' || state === 'loading';
			current.hidden = !t; if (!t) return;
			status.textContent = playing ? 'Now playing' : 'Ready when you are';
			title.textContent = W.title(t); artist.textContent = W.artist(t);
			ctx.U.btnState(continueButton, { label: playing ? 'Open player' : 'Resume listening', icon: playing ? 'queue' : 'play' });
		}
		updateCurrent();
		if (ctx.bus && ctx.bus.on) unwatch = ctx.bus.on('bar', updateCurrent);

		var start = h('section', { class: 'ts-home-start', aria: { label: 'Start listening' } });
		var dailyText = h('div', { class: 'ts-home-daily-text' });
		dailyText.appendChild(h('p', { class: 'ts-home-kicker', text: 'Made from your library' }));
		dailyText.appendChild(h('h2', { text: 'Today\'s mix' }));
		dailyText.appendChild(h('p', { class: 'ts-muted', text: daily.length ? W.plural(daily.length, 'song') + ', picked for today. A mix from your own library, kept steady throughout the day.' : music.length ? 'Today\'s library mix has no songs in this playlist. Shuffle this playlist or show everything to hear the full mix.' : 'There are no playable songs in this part of your library yet.' }));
		start.appendChild(dailyText);
		var actions = h('div', { class: 'ts-row-btns ts-home-start-actions' });
		var playDaily = ctx.U.btn({ label: 'Play today\'s mix', icon: 'play', variant: 'primary', on: { click: function () { ctx.play.from(daily, 0, { label: 'Today\'s mix', href: '#/' }); } } });
		playDaily.disabled = !daily.length; playDaily.setAttribute('data-home-daily', ''); actions.appendChild(playDaily);
		var shuffle = ctx.U.btn({ label: home.focused() ? 'Shuffle this playlist' : 'Shuffle library', icon: 'shuffle', variant: 'secondary', on: { click: function () { home.shuffle({}, { label: 'Everything', href: '#/songs' }); } } });
		shuffle.disabled = !music.length; actions.appendChild(shuffle);
		var rediscover = ctx.U.btn({ label: 'Rediscover', icon: 'history', variant: 'ghost', on: { click: function () { home.shuffle({}, { label: 'Rediscover', href: '#/' }, 'neglected'); } } });
		rediscover.disabled = !music.length; actions.appendChild(rediscover); start.appendChild(actions);
		var order = h('div', { class: 'ts-orderrow ts-home-order' }, h('span', { class: 'ts-muted', text: 'Shuffles use' }));
		order.appendChild(home.modePicker()); start.appendChild(order); root.appendChild(start);

		tracks(root, ctx, 'Recently played', home.recentlyPlayed(8), '#/history', 'History');
		var saved = home.savedLists().slice(0, 4);
		ctx.ui.sectionHead(root, 'Your playlists', { href: '#/lists', text: 'All playlists' });
		var playlists = h('div', { class: 'ts-home-links ts-home-playlists' });
		saved.forEach(function (li) { playlists.appendChild(link(ctx, li.name, li.kind === 'smart' ? 'Smart playlist' : 'Hand-picked playlist', ctx.link('list', li.id), li.kind === 'smart' ? 'mix' : 'list')); });
		if (!saved.length) playlists.appendChild(link(ctx, 'Make your first playlist', 'Keep a set of songs together, or save a smart filter', '#/lists', 'list'));
		root.appendChild(playlists);
		var discover = h('section', { class: 'ts-home-discover' });
		discover.appendChild(h('div', null, [h('p', { class: 'ts-home-kicker', text: 'Beyond the familiar' }), h('h2', { text: 'Follow an artist somewhere new' }), h('p', { class: 'ts-muted', text: 'Choose someone you listen to, browse their songs and albums, or meet similar artists. You choose when to search YouTube.' })]));
		discover.appendChild(h('a', { class: 'ts-btn ts-btn--secondary ts-btn--md', href: '#/for-you', text: 'Find more music' })); root.appendChild(discover);
		var savedDiscovery = h('div', { class: 'ts-home-links ts-home-discovery-links' });
		savedDiscovery.appendChild(link(ctx, 'Want to hear', 'Albums you bookmarked for another listen', '#/listening-shelf?tab=albums', 'bookmark'));
		savedDiscovery.appendChild(link(ctx, 'Discovery tray', 'Collect songs and albums into a playlist', '#/listening-shelf?tab=tray', 'list'));
		savedDiscovery.appendChild(link(ctx, 'Release inbox', 'Check new releases from artists you chose', '#/listening-shelf?tab=inbox', 'sparkle'));
		root.appendChild(savedDiscovery);

		var artists = Object.keys(ix.artists).map(function (k) { return ix.artists[k]; }).sort(function (a, b) { return (b.plays * 3 + b.tracks.length) - (a.plays * 3 + a.tracks.length) || a.name.localeCompare(b.name); }).slice(0, 8);
		if (artists.length) { ctx.ui.sectionHead(root, 'Your artists', { href: '#/artists', text: 'All artists' }); ctx.ui.shelf(root, artists.map(home.artistCard)); }
		var recent = home.sorted(music, 'added').slice(0, 8).map(function (t) { return t.id; });
		tracks(root, ctx, 'Recently added', recent, '#/songs?sort=added');

		var more = h('details', { class: 'ts-home-more' });
		more.appendChild(h('summary', null, [h('span', { text: 'More from your library' }), h('span', { class: 'ts-muted', text: 'Moods, stories, channels and old favourites' })]));
		var body = h('div', { class: 'ts-home-more-body' }); more.appendChild(body); root.appendChild(more);
		var mounted = false;
		function mountMore() {
			if (mounted || !more.open) return; mounted = true;
			var browse = h('div', { class: 'ts-home-links' });
			[
				['Moods & scenes', 'Find the mood for this moment', '#/browse', 'mood'],
				['Genres', W.plural(Object.keys(ix.genres).length, 'genre') + ' in your library', '#/genres', 'genre'],
				['Anime, games & stage', W.plural(Object.keys(ix.works).length, 'work') + ' behind your music', '#/works', 'works'],
				['Channels', 'The people who upload your music', '#/channels', 'channel'],
				['Mix builder', 'Choose the music and how it shuffles', '#/mix', 'mix'],
				['Map', 'See how your library connects', '#/map', 'map']
			].forEach(function (item) { browse.appendChild(link(ctx, item[0], item[1], item[2], item[3])); }); body.appendChild(browse);
			if (!home.focused()) {
				var suggestions = home.suggestions().slice(0, 6);
				if (suggestions.length) {
					ctx.ui.sectionHead(body, 'Listen inside one part of your library');
					var choices = h('div', { class: 'ts-chips ts-chipbar' });
					suggestions.forEach(function (s) { choices.appendChild(ctx.U.btn({ label: s.name + ' (' + W.n(s.n) + ')', variant: 'chip', on: { click: function () { home.focusOn(s.name, s.patch); } } })); }); body.appendChild(choices);
				}
			}
			if (TS.channel && TS.channel.homeShelf && !ctx.thumb) TS.channel.homeShelf(body, ctx);
			if (TS.habits && TS.habits.homeLane && !ctx.thumb) TS.habits.homeLane(body, ctx);
			if (TS.wrapped && TS.wrapped.homeLanes && !ctx.thumb) TS.wrapped.homeLanes(body, ctx);
			var neglected = ctx.S.neglected(music, ctx.S.rng(ctx.thumb ? 'home' : ToyKit.daily()), ctx.now()).slice(0, 8);
			tracks(body, ctx, 'Waiting for you', neglected, null);
		}
		more.addEventListener('toggle', mountMore);
		if (ix.needs.unsure && !ctx.demo) root.appendChild(link(ctx, 'A few labels need your help', W.plural(ix.needs.unsure, 'track') + ' without a sure artist', '#/fix', 'fix', 'ts-home-labels'));
		root.appendChild(h('p', { class: 'ts-legal', text: 'Uses YouTube API Services. ' }, [h('a', { href: 'https://www.youtube.com/t/terms', rel: 'noopener', text: 'YouTube Terms of Service' }), ' ' + W.DOT + ' ', h('a', { href: 'https://policies.google.com/privacy', rel: 'noopener', text: 'Google Privacy Policy' })]));
	}
	TS.home = { view: view, noMusic: noMusic, searchHandoff: searchHandoff };
})(window.TrueShuffle);
