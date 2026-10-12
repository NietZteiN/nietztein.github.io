// History view; application state is supplied afresh on each render.
(function (TS) {
	'use strict';
	TS.historyView = function (view, c) {
		var histCache = c.histCache, demo = c.demo, lib = c.lib, h = c.h, plural = c.plural, recentIds = c.recentIds, sectionHead = c.sectionHead, shelf = c.shelf, trackCard = c.trackCard, localDay = c.localDay, bars = c.bars, addedName = c.addedName, capital = c.capital, now = c.now, playNow = c.playNow, artFor = c.artFor, trackTitle = c.trackTitle, trackArtist = c.trackArtist, DOT = c.DOT, clock = c.clock;
		view.appendChild(h('h1', { class: 'ts-h1', text: 'History' }));
		if (!histCache.length) { view.appendChild(h('p', { class: 'ts-empty', text: demo ? 'The demo keeps no history.' : 'Nothing played yet. Everything you hear (to the end or at least half of it) and every skip is kept here, in this browser.' })); return; }
		var plays = histCache.filter(function (e) { return e.kind === 'play'; }).length;
		view.appendChild(h('p', { class: 'ts-muted ts-lede', text: plural(plays, 'play') + ' and ' + plural(histCache.length - plays, 'skip') + ' kept.' }));
		var rep = recentIds(30, 2).slice(0, 18);
		if (rep.length) { sectionHead(view, 'On repeat (last 30 days)'); shelf(view, rep.map(function (id, i) { return trackCard(lib.tracks[id], rep, i, { label: 'On repeat', href: '#/history' }); })); }
		// plays per month, a single-series bar list
		var months = {};
		histCache.forEach(function (e) { if (e.kind === 'play') { var m = localDay(e.at).slice(0, 7); months[m] = (months[m] || 0) + 1; } });
		bars(view, 'Plays per month', Object.keys(months).sort().slice(-12).map(function (m) { return { name: addedName(m), value: months[m] }; }), 'the last twelve months with plays');
		var byDay = {}, days = [];
		histCache.slice(0, 600).forEach(function (e) {
			if (!lib.tracks[e.id]) return;
			var d = localDay(e.at);
			if (!byDay[d]) { byDay[d] = []; days.push(d); }
			byDay[d].push(e);
		});
		days.forEach(function (d) {
			sectionHead(view, TS.recs ? capital(TS.recs.sinceWords(byDay[d][0].at, now())) : d === localDay(now()) ? 'Today' : d);
			var ul = h('ul', { class: 'ts-histlist' });
			byDay[d].forEach(function (e) {
				var t = lib.tracks[e.id];
				var li = h('li', { class: e.kind === 'skip' ? 'is-skip' : '' });
				li.appendChild(h('span', { class: 'ts-hist-time', text: new Date(e.at).toTimeString().slice(0, 5) }));
				var b = h('button', { class: 'ts-q-main', title: 'Play', on: { click: function () { playNow([t.id]); } } });
				b.appendChild(artFor(t, 'ts-q-art'));
				b.appendChild(h('span', { class: 'ts-q-text' }, [h('span', { class: 'ts-q-title', text: trackTitle(t) }), h('span', { class: 'ts-q-artist', text: trackArtist(t) + (e.kind === 'skip' ? ' ' + DOT + ' skipped after ' + clock(e.listenedSec) : '') })]));
				li.appendChild(b);
				ul.appendChild(li);
			});
			view.appendChild(ul);
		});
	};
})(window.TrueShuffle);
