// The listening destinations stay visible; secondary tools keep their own
// native links inside named disclosures. Every existing address remains usable.
(function (TS) {
	'use strict';
	var U = TS.ui, h = U.h, opened = {};
	var primary = [
		['', 'Home', 'home'], ['search', 'Search', 'search'], ['for-you', 'Discover', 'sparkle']
	];
	var library = [
		['songs', 'Songs', 'songs'], ['artists', 'Artists', 'artist'], ['lists', 'Playlists', 'list'], ['liked', 'Liked songs', 'heart'], ['listening-shelf', 'Listening shelf', 'bookmark']
	];
	var browse = [
		['genres', 'Genres', 'genre'], ['browse', 'Moods & scenes', 'mood'], ['works', 'Anime, games & stage', 'works'], ['channels', 'Channels', 'channel'], ['map', 'Map', 'map']
	];
	var tools = [
		['mix', 'Mix builder', 'mix'], ['history', 'History', 'history'], ['stats', 'Listening stats', 'stats'], ['label', 'Quick labeller', 'edit'], ['fix', 'Needs attention', 'fix'],
		['wrapped', 'Your year', 'medal', 'wrapped'], ['quiz', 'Guess the anime', 'tv', 'quiz'], ['duel', 'Rank your songs', 'blend', 'duel']
	];
	var tabs = [['', 'Home', 'home'], ['search', 'Search', 'search'], ['for-you', 'Discover', 'sparkle'], ['library', 'Library', 'songs'], ['queue', 'Queue', 'queue']];
	function render(ctx) {
		var nav = document.getElementById('nav'), tabbar = document.getElementById('tabbar'), section = ctx.section;
		U.clear(nav); U.clear(tabbar);
		function item(entry) {
			if (entry[3] && !ctx.moduleReady(entry[3])) return null;
			var on = section === entry[0], a = h('a', { class: 'ts-nav-a' + (on ? ' is-on' : ''), href: '#/' + entry[0], title: entry[1], aria: { label: entry[1], current: on ? 'page' : null } }, [U.icon(entry[2]), h('span', { class: 'ts-nav-label', text: entry[1] })]);
			if (entry[0] === 'fix' && ctx.need && ctx.songCount) a.appendChild(h('span', { class: 'ts-nav-count', text: ctx.need > 999 ? '999+' : String(ctx.need), title: ctx.need + ' songs without a sure artist' }));
			if (entry[0] === 'listening-shelf' && ctx.shelf && (ctx.shelf.tray || ctx.shelf.unseen)) a.appendChild(h('span', { class: 'ts-nav-count', text: String(ctx.shelf.tray || ctx.shelf.unseen), title: ctx.shelf.tray + ' collected / ' + ctx.shelf.unseen + ' unseen releases' }));
			return h('li', null, a);
		}
		function add(entries, target) { entries.forEach(function (entry) { var li = item(entry); if (li) target.appendChild(li); }); }
		function group(key, label, icon, entries) {
			var active = entries.some(function (entry) { return section === entry[0]; });
			var details = h('details', { class: 'ts-nav-group', open: active || !!opened[key] });
			var summary = h('summary', { title: label, aria: { label: label } }, [U.icon(icon), h('span', { class: 'ts-nav-label', text: label }), U.icon('down', 'ts-nav-chevron')]);
			var list = h('ul', { class: 'ts-nav-group-list' }); add(entries, list);
			details.appendChild(summary); details.appendChild(list);
			details.addEventListener('toggle', function () { if (details.isConnected) opened[key] = details.open; });
			nav.appendChild(h('li', null, details));
		}
		add(primary, nav); nav.appendChild(h('li', { class: 'ts-nav-sep', text: 'Your library' })); add(library, nav);
		group('browse', 'Browse library', 'genre', browse); group('tools', 'Tools & extras', 'mix', tools);
		add([['settings', 'Settings', 'settings']], nav);
		tabs.forEach(function (entry) {
			var on = entry[0] === 'library' ? ['songs', 'artists', 'genres', 'browse', 'works', 'stats', 'fix', 'settings', 'library', 'lists', 'map', 'history', 'label', 'channels', 'mix', 'wrapped', 'quiz', 'duel', 'listening-shelf'].indexOf(section) >= 0 : entry[0] === 'queue' ? ctx.queueOpen : section === entry[0];
			var a = h('a', { class: 'ts-tab-a' + (on ? ' is-on' : ''), href: entry[0] === 'queue' ? '#' : '#/' + entry[0], aria: { label: entry[1], current: on ? 'page' : null } }, [U.icon(entry[2]), h('span', { text: entry[1] })]);
			if (entry[0] === 'queue') a.addEventListener('click', function (event) { event.preventDefault(); ctx.toggleQueue(); });
			tabbar.appendChild(a);
		});
	}
	TS.navigation = { render: render };
})(window.TrueShuffle);
