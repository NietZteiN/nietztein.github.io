/*
 * True Shuffle: the action vocabulary. One label, one icon and at most one
 * key for each thing the page lets you do, so a button, a menu item, the
 * shortcuts list and the help all say the same words. test.js runs check():
 * no two actions share a label or a key, every icon exists, and an icon has
 * one meaning (a few families share theirs on purpose, listed in SHARED).
 *
 *     A.VOCAB['play-next'] -> { label: 'Play next', icon: 'queue-next' }
 *     A.item('play-next', fn, { hint })   a menu item for ui.js openMenu
 *     A.KEYMAP                            [{ keys, does }] for the shortcuts list and the help
 *     A.check(iconNames) -> []            the problems, or none
 *
 * UMD: window.TrueShuffle.actions in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.actions = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
	'use strict';

	var ELL = String.fromCharCode(0x2026);
	// label: the words everywhere; short: in a tight bar; icon: ui.js PATHS; key: the shortcut.
	var VOCAB = {
		'play': { label: 'Play', icon: 'play', desc: 'Play it now; what was coming stays after it' },
		'play-from-here': { label: 'Play from here', icon: 'play', desc: 'Play this list from this song on' },
		'play-all': { label: 'Play all', short: 'Play', icon: 'play' },
		'play-pause': { label: 'Play or pause', icon: 'play', key: 'Space' },
		'next': { label: 'Next song', icon: 'next', key: 'N' },
		'previous': { label: 'Previous song', icon: 'prev', key: 'P' },
		'shuffle': { label: 'Shuffle', icon: 'shuffle' },
		'reshuffle': { label: 'Shuffle again', icon: 'reshuffle', key: 'S', desc: 'Shuffle what comes next again' },
		'order': { label: 'Shuffle order', icon: 'shuffle', key: 'O', desc: 'Choose how the next songs are picked' },
		'play-next': { label: 'Play next', icon: 'queue-next' },
		'add-to-queue': { label: 'Add to queue', icon: 'queue-add' },
		'radio': { label: 'Start radio', short: 'Radio', icon: 'radio', desc: 'Songs like this one, one after another' },
		'discover': { label: 'Discover new songs like this', short: 'Discover', icon: 'compass' },
		'journey': { label: 'Journey from here' + ELL, icon: 'route' },
		'versions': { label: 'Other versions' + ELL, icon: 'versions' },
		'like': { label: 'Like', icon: 'heart', key: 'L', desc: 'Like the playing song' },
		'add-to-playlist': { label: 'Add to playlist' + ELL, icon: 'playlist-add' },
		'save-as-playlist': { label: 'Save as playlist' + ELL, icon: 'playlist-new' },
		'add-to-youtube': { label: 'Add to YouTube playlist' + ELL, icon: 'youtube-add' },
		'not-interested': { label: 'Not interested', icon: 'eye-off' },
		'remove': { label: 'Remove from queue', icon: 'minus-circle', key: 'Delete' },
		'remove-from-list': { label: 'Remove from playlist', icon: 'minus-circle' },
		'clear-queue': { label: 'Clear queue', icon: 'clear-all' },
		'block': { label: 'Block', icon: 'block', desc: 'Never shuffle it' },
		'unblock': { label: 'Unblock', icon: 'block' },
		'edit': { label: 'Edit details' + ELL, icon: 'edit', key: 'E', desc: 'Edit the playing song' },
		'label-each': { label: 'Label them one by one', icon: 'tag' },
		'details': { label: 'Song details', icon: 'info' },
		'rating': { label: 'Rating' + ELL, icon: 'star' },
		'retry-play': { label: 'Try playing again', icon: 'retry' },
		'go-artist': { label: 'Go to artist', icon: 'artist' },
		'go-work': { label: 'Go to work', icon: 'tv' },
		'go-channel': { label: 'Go to channel', icon: 'channel' },
		'open-youtube': { label: 'Open on YouTube', icon: 'external' },
		'focus': { label: 'Focus on this', icon: 'target' },
		'stop-focus': { label: 'Stop focusing', icon: 'target' },
		'repeat': { label: 'Repeat', icon: 'repeat', key: 'R', desc: 'Repeat the queue' },
		'queue': { label: 'Show or hide the queue', icon: 'queue', key: 'Q' },
		'theater': { label: 'Theater mode', icon: 'theater', key: 'T' },
		'fullscreen': { label: 'Full screen', icon: 'fullscreen', key: 'F' },
		'sleep': { label: 'Sleep timer' + ELL, icon: 'moon' },
		'mute': { label: 'Mute', icon: 'mute', key: 'M' },
		'volume': { label: 'Volume down or up', icon: 'volume', key: '- / =' },
		'seek': { label: 'Ten seconds back or on', icon: 'fwd', key: String.fromCharCode(0x2190) + ' / ' + String.fromCharCode(0x2192) },
		'search': { label: 'Search', icon: 'search', key: '/' },
		'palette': { label: 'Go to or do anything', icon: 'search', key: 'Ctrl+K' },
		'shortcuts': { label: 'Keyboard shortcuts', icon: 'keyboard', key: '?' },
		'see-all': { label: 'See all', icon: 'arrow-right' },
		'retry': { label: 'Try again', icon: 'retry' },
		'more': { label: 'More actions', icon: 'more' }
	};
	// Icons that several actions share, because they are one family.
	var SHARED = { play: 1, shuffle: 1, 'minus-circle': 1, block: 1, target: 1, search: 1, retry: 1 };

	// The keys, in the order the shortcuts list shows them.
	var KEY_ORDER = ['palette', 'play-pause', 'next', 'previous', 'reshuffle', 'order', 'repeat', 'like', 'mute', 'volume', 'seek', 'theater', 'fullscreen', 'queue', 'edit', 'search', 'shortcuts'];
	var KEYMAP = KEY_ORDER.map(function (k) { return { keys: VOCAB[k].key, does: VOCAB[k].desc || VOCAB[k].label, action: k }; }).concat([
		{ keys: 'In a list', does: String.fromCharCode(0x2191) + ' ' + String.fromCharCode(0x2193) + ' move, Enter play from there, Space select, E edit, Shift+F10 menu, Ctrl+A all' },
		{ keys: 'In the queue', does: 'Arrow keys on a grip move a song, Delete removes it' },
		{ keys: 'Quick labeller', does: '1' + String.fromCharCode(0x2013) + '6 mood, Enter save, ' + String.fromCharCode(0x2190) + ' ' + String.fromCharCode(0x2192) + ' back and skip, P play' }
	]);

	// A menu item for ui.js openMenu: the vocabulary's words and icon.
	function item(name, onSelect, opts) {
		var v = VOCAB[name];
		if (!v) throw new Error('actions: no action ' + name);
		opts = opts || {};
		return { label: opts.label || v.label, icon: v.icon, hint: opts.hint != null ? opts.hint : (v.key && v.key.length <= 6 ? v.key : undefined), desc: opts.desc, disabled: opts.disabled, checked: opts.checked, onSelect: onSelect };
	}
	function label(name) { return VOCAB[name] ? VOCAB[name].label : name; }

	// The problems with the vocabulary: [] when it is sound.
	function check(iconNames) {
		var out = [], labels = {}, keys = {}, icons = {};
		var known = {};
		(iconNames || []).forEach(function (n) { known[n] = true; });
		Object.keys(VOCAB).forEach(function (k) {
			var v = VOCAB[k];
			if (!v.label) out.push(k + ' has no label');
			if (labels[v.label]) out.push('"' + v.label + '" is the label of ' + labels[v.label] + ' and ' + k);
			labels[v.label] = k;
			if (v.key) { if (keys[v.key]) out.push('key ' + v.key + ' does ' + keys[v.key] + ' and ' + k); keys[v.key] = k; }
			if (iconNames && !known[v.icon]) out.push(k + ' uses an icon ui.js does not draw: ' + v.icon);
			(icons[v.icon] = icons[v.icon] || []).push(k);
		});
		Object.keys(icons).forEach(function (ic) { if (icons[ic].length > 1 && !SHARED[ic]) out.push('the icon ' + ic + ' means ' + icons[ic].join(' and ')); });
		return out;
	}

	return { VOCAB: VOCAB, KEYMAP: KEYMAP, SHARED: SHARED, item: item, label: label, check: check };
});
