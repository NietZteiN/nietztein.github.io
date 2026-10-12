/*
 * True Shuffle: the page's small parts. A DOM builder, icons, one button
 * component (btn, btnState, split, badge), the hash router, menus, dialogs, a
 * virtual list for long track lists, cover art, toasts, progress chips (job),
 * an event bus, and the player-safe zone (safe) that keeps every overlay off
 * the YouTube player. Everything inserts text with textContent: titles come from YouTube
 * and from files, and are untrusted.
 *
 * window.TrueShuffle.ui. Browser only.
 */
(function (root) {
	'use strict';

	// ---- Building nodes ---------------------------------------------------------------

	// h('button', { class: 'x', text: 'Play', on: { click: fn }, aria: { label: '...' }, data: { id: 1 } }, [children])
	function h(tag, opts, kids) {
		var e = document.createElement(tag);
		opts = opts || {};
		for (var k in opts) {
			var v = opts[k];
			if (v == null || v === false) continue;
			if (k === 'class') e.className = v;
			else if (k === 'text') e.textContent = v;
			else if (k === 'on') { for (var ev in v) e.addEventListener(ev, v[ev]); }
			else if (k === 'aria') { for (var a in v) if (v[a] != null) e.setAttribute('aria-' + a, String(v[a])); }
			else if (k === 'data') { for (var d in v) if (v[d] != null) e.dataset[d] = String(v[d]); }
			else if (k === 'style') { for (var s in v) e.style.setProperty(s, v[s]); }
			else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'selected') e[k] = !!v;
			else if (k === 'value') e.value = v;
			else e.setAttribute(k, v === true ? '' : String(v));
		}
		if (tag === 'button' && !opts.type) e.type = 'button';
		add(e, kids);
		return e;
	}
	function add(parent, kids) {
		if (kids == null) return parent;
		if (!Array.isArray(kids)) kids = [kids];
		kids.forEach(function (k) {
			if (k == null || k === false) return;
			parent.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
		});
		return parent;
	}
	function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

	// ---- Icons ----------------------------------------------------------------------------
	// 24 by 24, filled with currentColor.
	var PATHS = {
		home: 'M12 3.2 2.5 11h2.7v9.3h5.2v-6h3.2v6h5.2V11h2.7z',
		search: 'M10.5 3a7.5 7.5 0 0 1 6 12l4.8 4.8-1.6 1.6-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 0 0 0-10.6z',
		songs: 'M9 3.5v11.1A3.6 3.6 0 1 0 11.2 18V8h6.3V3.5zM4 20.5h2v-2H4z',
		artist: 'M12 2.8a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2zM3.5 21c.5-4.4 4-7 8.5-7s8 2.6 8.5 7z',
		genre: 'M3.5 3.5h7.5V11H3.5zm9.5 0h7.5V11H13zM3.5 13H11v7.5H3.5zm9.5 0h7.5v7.5H13z',
		works: 'M4 4h16v12.5H4zm2 2v8.5h12V6zM8 18.5h8V20H8z',
		mood: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm-3.3 7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm6.6 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM7.4 14c.9 2 2.6 3.2 4.6 3.2s3.7-1.2 4.6-3.2z',
		mix: 'M4 6h9.2a2.6 2.6 0 0 1 5 0H20v2h-1.8a2.6 2.6 0 0 1-5 0H4zm0 10h1.8a2.6 2.6 0 0 1 5 0H20v2h-9.2a2.6 2.6 0 0 1-5 0H4z',
		stats: 'M4 20V10h3.5v10zm6.2 0V4h3.6v16zm6.3 0v-7H20v7z',
		fix: 'M14.6 3.3a5 5 0 0 0-4.8 6.6L3.4 16.3a1.9 1.9 0 0 0 2.7 2.7l6.4-6.4a5 5 0 0 0 6.6-4.8l-2.9 2.9-2.6-.4-.4-2.6z',
		settings: 'M10.3 2.5h3.4l.5 2.6c.7.3 1.3.6 1.9 1.1l2.5-.9 1.7 2.9-2 1.7c.1.7.1 1.4 0 2.1l2 1.7-1.7 2.9-2.5-.9c-.6.5-1.2.8-1.9 1.1l-.5 2.6h-3.4l-.5-2.6c-.7-.3-1.3-.6-1.9-1.1l-2.5.9-1.7-2.9 2-1.7a7 7 0 0 1 0-2.1l-2-1.7 1.7-2.9 2.5.9c.6-.5 1.2-.8 1.9-1.1zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
		play: 'M7 4.5v15l13-7.5z',
		pause: 'M6.5 5h4v14h-4zm7 0h4v14h-4z',
		next: 'M15.6 5H18v14h-2.4zM4 5.6v12.8L14.4 12z',
		prev: 'M6 5h2.4v14H6zm14 .6v12.8L9.6 12z',
		shuffle: 'M3 7h3.6c2.1 0 3.4.9 4.6 2.8l1.6 2.6c.9 1.5 1.7 2 3.2 2H18v-2.2l3.6 3.3L18 18.8v-2.2h-2c-2.2 0-3.6-.9-4.9-3L9.5 11c-.8-1.3-1.5-1.8-2.9-1.8H3zm15 .4V5.2l3.6 3.3L18 11.8V9.6h-2c-1 0-1.7.3-2.3.9l-1.2-2c.9-.8 2-1.1 3.5-1.1zM3 14.8h3.6c.9 0 1.6-.2 2.1-.7l1.2 2c-.9.7-1.9 1-3.3 1H3z',
		spread: 'M3 6h4v4H3zm7 4h4v4h-4zm7 4h4v4h-4zM3 16h4v2H3zm14-10h4v2h-4z',
		fresh: 'M12 2l2.4 6.6L21 9l-5.2 4.3 1.8 6.7L12 16.4 6.4 20l1.8-6.7L3 9l6.6-.4z',
		heart: 'M12 20.3 4.6 13a4.9 4.9 0 0 1 7-6.9l.4.4.4-.4a4.9 4.9 0 1 1 7 6.9z',
		history: 'M12.5 3a9 9 0 1 1-8.4 12.1l2-.7A6.9 6.9 0 1 0 6 9.5H9L5 13.5 1 9.5h2.9A9 9 0 0 1 12.5 3zM11.5 7h2v5l3.6 2.1-1 1.7-4.6-2.7z',
		rotate: 'M12 4a8 8 0 0 1 7.7 5.9h-2.2A6 6 0 0 0 6.3 9H9l-3.5 4L2 9h2.2A8 8 0 0 1 12 4zm6.5 7L22 15h-2.2A8 8 0 0 1 4.3 14.1h2.2A6 6 0 0 0 17.7 15H15z',
		blocks: 'M3 5h8v6H3zm10 0h8v6h-8zM3 13h8v6H3zm10 0h8v6h-8z',
		newest: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-1 4v6l5 3 1-1.6-4-2.4V7z',
		list: 'M4 6h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z',
		queue: 'M3 5h13v2H3zm0 4.5h13v2H3zm0 4.5h8v2H3zm11 0 7 3.5-7 3.5z',
		more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
		star: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z',
		radio: 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM7.1 7.1l1.4 1.4a5 5 0 0 0 0 7l-1.4 1.4a7 7 0 0 1 0-9.8zm9.8 0a7 7 0 0 1 0 9.8l-1.4-1.4a5 5 0 0 0 0-7zM4.2 4.2l1.4 1.4a9 9 0 0 0 0 12.8l-1.4 1.4a11 11 0 0 1 0-15.6zm15.6 0a11 11 0 0 1 0 15.6l-1.4-1.4a9 9 0 0 0 0-12.8z',
		edit: 'M15.6 3.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L9.3 19.5 3.5 20.5l1-5.8zM14.2 7.8 6.4 15.6l-.5 2.5 2.5-.5 7.8-7.8z',
		block: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM6.8 8.3a7.3 7.3 0 0 0 8.9 8.9zm1.5-1.5 8.9 8.9a7.3 7.3 0 0 0-8.9-8.9z',
		back: 'M15.4 4.6 8 12l7.4 7.4-1.6 1.6L4.8 12l9-9z',
		fwd: 'M8.6 4.6 16 12l-7.4 7.4 1.6 1.6 9-9-9-9z',
		close: 'M6.2 4.8 12 10.6l5.8-5.8 1.4 1.4L13.4 12l5.8 5.8-1.4 1.4L12 13.4l-5.8 5.8-1.4-1.4 5.8-5.8-5.8-5.8z',
		down: 'M5.6 8.6 12 15l6.4-6.4 1.6 1.6-8 8-8-8z',
		check: 'M9.5 16.2 4.8 11.5l-1.6 1.6 6.3 6.3L21 7.9l-1.6-1.6z',
		external: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z',
		plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
		playnext: 'M3 5h11v2H3zm0 4.5h11v2H3zM3 14h7v2H3zm10-2v8l6-4z',
		grip: 'M8 5h3v3H8zm5 0h3v3h-3zm-5 5.5h3v3H8zm5 0h3v3h-3zM8 16h3v3H8zm5 0h3v3h-3z',
		'sort-direction': 'M7 3 3 7l1.4 1.4L6 6.8V20h2V6.8l1.6 1.6L11 7zM17 21l4-4-1.4-1.4-1.6 1.6V4h-2v13.2l-1.6-1.6L13 17z',
		upload: 'M11 16V7.8L7.4 11.4 6 10l6-6 6 6-1.4 1.4L13 7.8V16zm-6 2h14v2H5z',
		download: 'M11 4h2v8.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4 3.6 3.6zm-6 14h14v2H5z',
		volume: 'M3 9h4l5-4.5v15L7 15H3zm12.5-1.8a6 6 0 0 1 0 9.6l-1.3-1.6a4 4 0 0 0 0-6.4zM17.6 4a10 10 0 0 1 0 16l-1.3-1.6a8 8 0 0 0 0-12.8z',
		mute: 'M3 9h4l5-4.5v15L7 15H3zm12.3.2 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z',
		theater: 'M2.5 5h19v14h-19zm2 2v10h15V7z',
		fullscreen: 'M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z',
		pip: 'M2.5 4h19v16h-19zm2 2v12h15V6zM11.5 11h7v5h-7z',
		keyboard: 'M2 6h20v12H2zm2 2v8h16V8zm1 1h2v2H5zm3 0h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2zm3 0h2v2h-2zM5 12h2v2H5zm3 0h8v2H8zm9 0h2v2h-2z',
		compass: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 2.2a7.3 7.3 0 1 0 0 14.6 7.3 7.3 0 0 0 0-14.6zm4.2 3.1-2.6 5.8-5.8 2.6 2.6-5.8zM12 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
		map: 'M9 3.5 3 6v14.5l6-2.5 6 2.5 6-2.5V3.5L15 6zm1 2.3 4 1.7v11.7l-4-1.7zM5 7.3l3-1.2v11.6l-3 1.2zm11 .2 3-1.2v11.5l-3 1.3z',
		repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
		moon: 'M14.5 2.5a9.5 9.5 0 1 0 7 15.8A8 8 0 0 1 14.5 2.5z',
		disc: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 6.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
		// One meaning each (README "The page", the action vocabulary in actions.js).
		'queue-next': 'M3 5h11v2H3zm0 4.5h11v2H3zM3 14h7v2H3zm10-2v8l6-4z',
		'queue-add': 'M3 5h13v2H3zm0 4.5h13v2H3zm0 4.5h7v2H3zm13-1h2v3h3v2h-3v3h-2v-3h-3v-2h3z',
		reshuffle: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5zm3.3 1.6a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm7.4 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM12 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM8.3 14a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zm7.4 0a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z',
		sparkle: 'M11 2l1.9 5.6 5.6 1.9-5.6 1.9L11 17l-1.9-5.6-5.6-1.9 5.6-1.9zm7 11l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z',
		blend: 'M9 5a7 7 0 1 1 0 14A7 7 0 0 1 9 5zm6 0a7 7 0 1 1 0 14 7 7 0 0 1 0-14z',
		infinity: 'M7 7.5c2 0 3.4 1.6 5 3.4 1.6-1.8 3-3.4 5-3.4a4.5 4.5 0 0 1 0 9c-2 0-3.4-1.6-5-3.4-1.6 1.8-3 3.4-5 3.4a4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 0 0 0 5c1.2 0 2.2-1.1 3.6-2.5C9.2 10.6 8.2 9.5 7 9.5zm10 0c-1.2 0-2.2 1.1-3.6 2.5 1.4 1.4 2.4 2.5 3.6 2.5a2.5 2.5 0 0 0 0-5z',
		headphones: 'M12 3a9 9 0 0 1 9 9v6a3 3 0 0 1-3 3h-2v-8h3v-1a7 7 0 0 0-14 0v1h3v8H6a3 3 0 0 1-3-3v-6a9 9 0 0 1 9-9z',
		bookmark: 'M6 3h12v18l-6-4-6 4zm2 2v12.3l4-2.7 4 2.7V5z',
		'playlist-add': 'M3 5h11v2H3zm0 4h11v2H3zm0 4h7v2H3zM17 5h4v2.5h-2V16a3 3 0 1 1-2-2.8z',
		'playlist-new': 'M3 3h12v2H5v14h14v-8h2v10H3zm15-1h2v3h3v2h-3v3h-2V7h-3V5h3zM7 9h7v2H7zm0 4h9v2H7z',
		'youtube-add': 'M4 5h12a3 3 0 0 1 3 3v3h-2V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8v2H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zm4 4.5 5 2.5-5 2.5zM18 13h2v3h3v2h-3v3h-2v-3h-3v-2h3z',
		'eye-off': 'M3.3 2.3l18.4 18.4-1.4 1.4-3.6-3.6A10.6 10.6 0 0 1 12 19.5C6.5 19.5 2.7 15.4 1 12a13.6 13.6 0 0 1 3.9-5L1.9 3.7zM12 4.5c5.5 0 9.3 4.1 11 7.5a13 13 0 0 1-2.9 4.1l-3.5-3.5A5 5 0 0 0 11 7.4L8.7 5.1A9.8 9.8 0 0 1 12 4.5zM6.3 8.4A11 11 0 0 0 3.3 12c1.6 2.8 4.8 5.5 8.7 5.5 1.2 0 2.2-.2 3.2-.6l-1.6-1.6a5 5 0 0 1-4.8-4.8z',
		'minus-circle': 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 2a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM7 11h10v2H7z',
		'clear-all': 'M3 6h14v2H3zm0 5h10v2H3zm0 5h8v2H3zm12.6-.6 1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2z',
		trash: 'M9 3h6l1 1.5h4v2H4v-2h4zM5.5 8h13l-1.1 13H6.6zm4 2.5v8h1.6v-8zm3.4 0v8h1.6v-8z',
		info: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 2a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM11 10.5h2V17h-2zm1-3.8a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
		versions: 'M7 3h14v14h-2V5H7zM3 7h14v14H3zm2 2v10h10V9z',
		album: 'M3 3h18v18H3zm2 2v14h14V5zm7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 3.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
		tv: 'M4 4h16v12.5H4zm2 2v8.5h12V6zM8 18.5h8V20H8z',
		channel: 'M3 5h18v13H3zm2 2v9h14V7zm4.5 1.5 6 3.5-6 3.5zM8 19.5h8V21H8z',
		ytmix: 'M6 3h12v2H6zM4 6.5h16v2H4zM2 10h20v11H2zm8 2.5v6l5-3z',
		route: 'M5 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm14 12a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM4 9.8h2V13a2 2 0 0 0 2 2h3v-4a4 4 0 0 1 4-4h3v2h-3a2 2 0 0 0-2 2v6H8a4 4 0 0 1-4-4z',
		sliders: 'M4 6h9.2a2.6 2.6 0 0 1 5 0H20v2h-1.8a2.6 2.6 0 0 1-5 0H4zm0 10h1.8a2.6 2.6 0 0 1 5 0H20v2h-9.2a2.6 2.6 0 0 1-5 0H4z',
		target: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 2a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm0 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
		'arrow-right': 'M4 11h12.2l-5-5 1.4-1.4L20 12l-7.4 7.4-1.4-1.4 5-5H4z',
		retry: 'M12 4a8 8 0 1 1-7.9 9.3l2-.4A6 6 0 1 0 8 7.5L10.5 10H3.5V3l2.9 2.9A8 8 0 0 1 12 4z',
		meter: 'M12 4a10 10 0 0 1 10 10c0 1.9-.5 3.6-1.4 5.1l-1.7-1A8 8 0 1 0 5 18.1l-1.7 1A10 10 0 0 1 12 4zm4.9 4.7 1.4 1.4-4.8 4.8a2 2 0 1 1-1.4-1.4z',
		car: 'M6.5 5h11l2.3 6H21v7h-2v2h-2.5v-2h-9v2H5v-2H3v-7h1.2zm1.4 2-1.5 4h11.2l-1.5-4zM6.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm11 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
		'wifi-off': 'M3.3 2.3l18.4 18.4-1.4 1.4-6.4-6.4a3.5 3.5 0 0 0-4.4.6l-1.4-1.4a5.5 5.5 0 0 1 3.9-1.6L9.4 10.7a8.5 8.5 0 0 0-3.7 2.2l-1.4-1.4a10.6 10.6 0 0 1 3.6-2.3L5.6 6.9a14 14 0 0 0-3.2 2.4L1 7.9a16 16 0 0 1 3.1-2.5L1.9 3.7zM12 4.5c4.1 0 7.9 1.6 10.7 4.2l-1.4 1.4A13 13 0 0 0 10.5 6.6zm2.8 4.2a10.7 10.7 0 0 1 4.6 2.8L18 12.9a8.6 8.6 0 0 0-1.7-1.3zM12 17a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
		'check-circle': 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm4.3 5.6-5.6 5.6-2.9-2.9-1.4 1.4 4.3 4.3 7-7z',
		medal: 'M7 2h4l1 2.8L13 2h4l-2.6 6.3a6.5 6.5 0 1 1-4.8 0zm5 8.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
		leaf: 'M20 3.5c-.9 9.4-5.6 14.5-13 14.5-.7 0-1.4-.1-2.1-.3L3 20.5l-1.4-1.4 2.1-2.1A9.6 9.6 0 0 1 3 13c0-6 6-9.5 17-9.5zM6 15.3c2.9-2.8 6-5 9.3-6.4-4.1.7-7.3 2.9-9.3 6.4z',
		tag: 'M3 3h8.2l9.8 9.8L12.8 21 3 11.2zm4.5 2.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
		scissors: 'M6 3a3 3 0 0 1 2.8 4.1L11 9.3l7.6-7.6 1.4 1.4-15.7 15.7a3 3 0 1 1-1.4-1.4L5.2 15.2A3 3 0 1 1 6 3zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm7.6-5.2 6.4 6.4-1.4 1.4-6.4-6.4z',
		speed: 'M3 6l8 6-8 6zm9 0l8 6-8 6z',
		share: 'M17 2.5a3.5 3.5 0 1 1-2.6 5.8L9.2 11a3.5 3.5 0 0 1 0 2l5.2 2.7a3.5 3.5 0 1 1-.9 1.8l-5.2-2.7a3.5 3.5 0 1 1 0-5.6l5.2-2.7A3.5 3.5 0 0 1 17 2.5zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-11 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm11 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
		phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v12h8V5zm3 13.5v1.5h2v-1.5z',
		paste: 'M9 2h6a1 1 0 0 1 1 1v1h3v18H5V4h3V3a1 1 0 0 1 1-1zm1 2v2h4V4zM7 6v14h10V6h-1v2H8V6zm2 5h6v2H9zm0 4h6v2H9z'
	};
	// Shapes drawn as outlines (a hole inside a filled shape) use the even-odd rule.
	var EVENODD = { share: 1, paste: 1, scissors: 1, reshuffle: 1, blend: 1, infinity: 1, bookmark: 1, 'playlist-new': 1, 'youtube-add': 1, 'eye-off': 1, 'minus-circle': 1, trash: 1, info: 1, versions: 1, album: 1, channel: 1, ytmix: 1, target: 1, car: 1, 'check-circle': 1, medal: 1, tag: 1 };
	var NS = 'http://www.w3.org/2000/svg';
	function icon(name, cls) {
		var svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		svg.setAttribute('class', 'ts-i' + (cls ? ' ' + cls : ''));
		var p = document.createElementNS(NS, 'path');
		p.setAttribute('d', PATHS[name] || PATHS.disc);
		if (EVENODD[name]) p.setAttribute('fill-rule', 'evenodd');
		svg.appendChild(p);
		return svg;
	}

	// ---- Buttons: one component -------------------------------------------------------------
	// U.btn({ label, icon, variant, size, iconOnly, pressed, menu, cost, kbd, busy, busyLabel,
	//         href, target, rel, type, disabled, title, cls, on, aria, data })
	// variant: primary (at most one per surface) | secondary | ghost | icon | chip | danger
	// size: sm 32 | md 40 | lg 48 | xl 56 | 2xl 72 | car 96 (px). A cost is a badge, never words
	// in the label; the accessible name says it ("Play, uses 100 YouTube units").
	function btn(o) {
		o = o || {};
		var variant = o.variant || (o.iconOnly ? 'icon' : 'secondary');
		var iconOnly = !!o.iconOnly || variant === 'icon';
		var size = o.size || (variant === 'chip' ? 'sm' : 'md');
		var b = h(o.href ? 'a' : 'button', {
			class: 'ts-btn ts-btn--' + variant + ' ts-btn--' + size + (iconOnly ? ' is-icon' : '') + (o.cls ? ' ' + o.cls : ''),
			href: o.href, target: o.target, rel: o.rel, type: o.type,
			title: o.title || (iconOnly ? (o.label || '') + (o.kbd ? ' (' + o.kbd + ')' : '') : (o.kbd ? (o.label || '') + ' (' + o.kbd + ')' : null)),
			disabled: o.disabled, data: o.data, on: o.on
		});
		b.dataset.label = o.label || '';
		b.dataset.icon = o.icon || '';
		if (o.icon) b.appendChild(icon(o.icon));
		if (!iconOnly) b.appendChild(h('span', { class: 'ts-btn-label', text: o.label || '' }));
		if (o.menu) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); if (!iconOnly) b.appendChild(icon('down', 'ts-btn-caret')); }
		if (o.busyLabel) b.dataset.busyLabel = o.busyLabel;
		if (o.aria) for (var a in o.aria) if (o.aria[a] != null) b.setAttribute('aria-' + a, String(o.aria[a]));
		btnState(b, { pressed: o.pressed, cost: o.cost, busy: o.busy });
		return b;
	}
	// Change a button in place: { pressed, busy, label, icon, cost, disabled }.
	function btnState(b, s) {
		if (!b || !s) return b;
		if (s.pressed != null) { b.setAttribute('aria-pressed', s.pressed ? 'true' : 'false'); b.classList.toggle('is-on', !!s.pressed); }
		if (s.label != null) { b.dataset.label = s.label; var l = b.querySelector('.ts-btn-label'); if (l) l.textContent = s.label; if (b.title && b.classList.contains('is-icon')) b.title = s.label; }
		if (s.icon) { b.dataset.icon = s.icon; setIcon(b, s.icon); }
		if ('cost' in s) {
			var old = b.querySelector('.ts-btn-cost');
			if (old) old.parentNode.removeChild(old);
			b.dataset.cost = s.cost ? String(s.cost) : '';
			if (s.cost) b.appendChild(badge('cost', String(s.cost), 'ts-btn-cost'));
		}
		if (s.busy != null) {
			b.classList.toggle('is-busy', !!s.busy);
			b.setAttribute('aria-busy', s.busy ? 'true' : 'false');
			b.disabled = !!s.busy || !!s.disabled;
			var lb = b.querySelector('.ts-btn-label');
			if (lb && b.dataset.busyLabel) lb.textContent = s.busy ? b.dataset.busyLabel : b.dataset.label;
		} else if (s.disabled != null) b.disabled = !!s.disabled;
		var name = (b.dataset.label || '') + (b.dataset.cost ? ', uses ' + b.dataset.cost + ' YouTube units' : '');
		if (b.classList.contains('is-icon') || b.dataset.cost) b.setAttribute('aria-label', name); else b.removeAttribute('aria-label');
		return b;
	}
	// The main action and a caret that opens a menu: Shuffle | its order.
	function split(main, caret) {
		var g = h('div', { class: 'ts-split', role: 'group', aria: { label: main.label || 'Actions' } });
		var a = btn(main), c = btn(Object.assign({ icon: 'down', iconOnly: true, variant: main.variant || 'secondary', size: main.size || 'md', menu: true }, caret || {}));
		a.classList.add('ts-split-main');
		c.classList.add('ts-split-caret');
		g.appendChild(a);
		g.appendChild(c);
		return g;
	}
	// A small label: kind is 'cost', 'ok' (in your library), 'new', or a source
	// ('mix', 'channel', 'anime', 'season', 'album', 'ext', 'search', 'library').
	function badge(kind, text, cls) {
		var b = h('span', { class: 'ts-badge ts-badge--' + kind + (cls ? ' ' + cls : '') });
		if (kind === 'cost') b.appendChild(icon('meter'));
		if (kind === 'ok') b.appendChild(icon('check-circle'));
		b.appendChild(h('span', { text: text }));
		return b;
	}
	// A setting that is on or off: a box, a short title and a line on what it does.
	// o: { title, desc, checked, disabled, onChange(on) }; the box is the label's `.input`.
	function check(o) {
		var cb = h('input', { type: 'checkbox', checked: !!o.checked, disabled: !!o.disabled });
		if (o.onChange) cb.addEventListener('change', function () { o.onChange(cb.checked); });
		var text = h('span', { class: 'ts-check-text' }, [h('span', { class: 'ts-check-t', text: o.title })]);
		if (o.desc) text.appendChild(h('span', { class: 'ts-check-d', text: o.desc }));
		var lab = h('label', { class: 'ts-check ts-setting' }, [cb, text]);
		lab.input = cb;
		return lab;
	}
	// A button with an icon and a label (shown, or for screen readers only): the
	// same component, as an icon button or a ghost one with text.
	function iconBtn(name, label, opts) {
		opts = opts || {};
		return btn({ icon: name, label: label, iconOnly: !opts.text, variant: opts.text ? 'ghost' : 'icon', cls: 'ts-icon-btn' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || label, on: opts.on });
	}
	function setIcon(btn, name) {
		var old = btn.querySelector('svg.ts-i');
		var fresh = icon(name);
		if (old) btn.replaceChild(fresh, old); else btn.insertBefore(fresh, btn.firstChild);
	}

	// ---- The router -----------------------------------------------------------------------
	// '#/artist/paperlanterns?x=1' -> { parts: ['artist', 'paperlanterns'], query: URLSearchParams, path: '/artist/paperlanterns' }
	function parseHash(hash) {
		var s = String(hash || '').replace(/^#/, '');
		if (s.charAt(0) !== '/') s = '/' + s;
		var qi = s.indexOf('?');
		var path = qi >= 0 ? s.slice(0, qi) : s, query = new URLSearchParams(qi >= 0 ? s.slice(qi + 1) : '');
		var parts = path.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
		return { parts: parts, query: query, path: path };
	}
	function link() {
		var parts = Array.prototype.slice.call(arguments);
		return '#/' + parts.map(function (p) { return encodeURIComponent(String(p)); }).join('/');
	}

	// ---- Menus ------------------------------------------------------------------------------
	// items: [{ label, icon, onSelect, disabled, checked, sep, hint }]. at: an element (the menu
	// opens under it) or { x, y }. Arrow keys, Enter, Escape; returns focus to `returnTo`.
	var openMenuEl = null, menuReturn = null, menuAnchor = null;
	function closeMenu() {
		if (!openMenuEl) return;
		var m = openMenuEl;
		openMenuEl = null;
		if (menuAnchor && menuAnchor.setAttribute && menuAnchor.hasAttribute('aria-expanded')) menuAnchor.setAttribute('aria-expanded', 'false');
		menuAnchor = null;
		if (m.parentNode) m.parentNode.removeChild(m);
		document.removeEventListener('pointerdown', outside, true);
		if (menuReturn && menuReturn.nodeType && document.body.contains(menuReturn)) { try { menuReturn.focus(); } catch (e) { /* gone */ } }
		menuReturn = null;
	}
	function outside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) { menuReturn = null; closeMenu(); } }
	function openMenu(at, items, opts) {
		closeMenu();
		opts = opts || {};
		var m = h('div', { class: 'ts-menu', role: 'menu', aria: { label: opts.label || 'Actions' } });
		var buttons = [];
		items.forEach(function (it) {
			if (!it) return;
			if (it.sep) { m.appendChild(h('div', { class: 'ts-menu-sep', role: 'separator' })); return; }
			if (it.heading) { m.appendChild(h('div', { class: 'ts-menu-h', text: it.heading })); return; }
			var b = h('button', { class: 'ts-menu-item' + (it.checked ? ' is-checked' : '') + (it.danger ? ' ts-danger' : ''), role: it.checked != null ? 'menuitemradio' : 'menuitem', disabled: it.disabled, tabindex: '-1', aria: { checked: it.checked != null ? !!it.checked : null } });
			b.appendChild(it.icon ? icon(it.icon) : h('span', { class: 'ts-i-sp' }));
			if (it.desc) b.appendChild(h('span', { class: 'ts-menu-two' }, [h('span', { class: 'ts-menu-label', text: it.label }), h('span', { class: 'ts-menu-desc', text: it.desc })]));
			else b.appendChild(h('span', { class: 'ts-menu-label', text: it.label }));
			if (it.hint) b.appendChild(h('span', { class: 'ts-menu-hint' + (it.keyHint ? ' is-key' : ''), text: it.hint }));
			if (it.checked) b.appendChild(icon('check', 'ts-menu-check'));
			b.addEventListener('click', function () { menuReturn = opts.returnTo || null; closeMenu(); if (it.onSelect) it.onSelect(); });
			m.appendChild(b);
			buttons.push(b);
		});
		m.addEventListener('keydown', function (e) {
			var live = buttons.filter(function (b) { return !b.disabled; }), i = live.indexOf(document.activeElement);
			if (e.key === 'ArrowDown') { e.preventDefault(); live[(i + 1) % live.length].focus(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); live[(i - 1 + live.length) % live.length].focus(); }
			else if (e.key === 'Home') { e.preventDefault(); live[0].focus(); }
			else if (e.key === 'End') { e.preventDefault(); live[live.length - 1].focus(); }
			else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
		});
		document.body.appendChild(m);
		openMenuEl = m;
		menuReturn = opts.returnTo || (at && at.nodeType ? at : document.activeElement);
		if (at && at.nodeType && at.hasAttribute('aria-haspopup')) { menuAnchor = at; at.setAttribute('aria-expanded', 'true'); }
		// place it inside the window, and off the YouTube player
		var r = at && at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
		var mw = m.offsetWidth, mh = m.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
		safe.rects().forEach(function (rect) { if (rect.right - rect.left > vw - mw - 16 && rect.bottom < vh - 16) m.style.maxHeight = (vh - rect.bottom - 16) + 'px'; }); mh = m.offsetHeight;
		var x = opts.alignRight ? r.right - mw : r.left, y = r.bottom + 4;
		if (y + mh > vh - 8) y = Math.max(8, r.top - mh - 4);
		x = Math.max(8, Math.min(x, vw - mw - 8));
		var placed = safe.avoid({ x: x, y: y, w: mw, h: mh }, vw, vh);
		m.style.left = placed.x + 'px';
		m.style.top = placed.y + 'px';
		safe.cover({ left: placed.x, top: placed.y, right: placed.x + mw, bottom: placed.y + mh });
		setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
		var first = buttons.filter(function (b) { return !b.disabled; })[opts.focusChecked ? Math.max(0, buttons.findIndex(function (b) { return b.classList.contains('is-checked'); })) : 0];
		if (first) first.focus();
		return m;
	}

	// ---- Dialogs -------------------------------------------------------------------------------
	// A modal dialog. -> { node, body, close }. onClose runs once.
	var dialogs = [];
	function openDialog(opts) {
		var back = h('div', { class: 'ts-modal-back' });
		var box = h('div', { class: 'ts-modal' + (opts.wide ? ' is-wide' : ''), role: 'dialog', aria: { modal: 'true', labelledby: 'ts-modal-h' + dialogs.length } });
		var head = h('div', { class: 'ts-modal-head' }, [h('h2', { id: 'ts-modal-h' + dialogs.length, text: opts.title || '' })]);
		var x = iconBtn('close', 'Close');
		head.appendChild(x);
		var body = h('div', { class: 'ts-modal-body' });
		box.appendChild(head);
		box.appendChild(body);
		back.appendChild(box);
		var returnTo = document.activeElement, closed = false;
		function close() {
			if (closed) return;
			closed = true;
			dialogs = dialogs.filter(function (d) { return d !== api; });
			if (back.parentNode) back.parentNode.removeChild(back);
			if (opts.onClose) opts.onClose();
			if (returnTo && document.body.contains(returnTo)) { try { returnTo.focus(); } catch (e) { /* gone */ } }
		}
		x.addEventListener('click', close);
		back.addEventListener('pointerdown', function (e) { if (e.target !== back) return; if (opts.keepOpen && opts.keepOpen()) { e.preventDefault(); return; } close(); });
		box.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
			if (e.key !== 'Tab') return;
			var f = Array.prototype.filter.call(box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.offsetParent !== null; });
			if (!f.length) return;
			if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
			else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
		});
		safe.cover(null);
		document.body.appendChild(back);
		var api = { node: box, body: body, close: close };
		dialogs.push(api);
		return api;
	}
	function dialogOpen() { return dialogs.length > 0 || !!openMenuEl; }

	// ---- A virtual list ---------------------------------------------------------------------
	// Draws only the rows near the visible part of `scroller`. rowHeight in px.
	// render(i) -> a row element (absolutely placed by the list).
	function virtualList(opts) {
		var box = h('div', { class: 'ts-vlist', role: opts.role || 'list', aria: { label: opts.label } });
		var count = 0, rowH = opts.rowHeight, drawn = {}, raf = 0;
		var scroller = opts.scroller;
		function place() {
			raf = 0;
			if (!box.isConnected) return;
			var top = box.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			var viewH = scroller.clientHeight;
			var from = Math.max(0, Math.floor(-top / rowH) - 8), to = Math.min(count, Math.ceil((viewH - top) / rowH) + 8);
			var keep = {};
			for (var i = from; i < to; i++) {
				keep[i] = true;
				if (!drawn[i]) {
					var row = opts.render(i);
					row.style.top = (i * rowH) + 'px';
					row.style.height = rowH + 'px';
					row.dataset.index = i;
					box.appendChild(row);
					drawn[i] = row;
				}
			}
			for (var k in drawn) if (!keep[k]) { box.removeChild(drawn[k]); delete drawn[k]; }
		}
		function schedule() { if (!raf) raf = requestAnimationFrame(place); }
		scroller.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		function set(n) {
			count = n;
			box.style.height = (n * rowH) + 'px';
			refresh();
		}
		function refresh() {
			for (var k in drawn) box.removeChild(drawn[k]);
			drawn = {};
			place();
		}
		function row(i) { return drawn[i] || null; }
		function reveal(i) {
			var top = box.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + i * rowH;
			var inset = opts.inset ? opts.inset() : 60;
			if (top < scroller.scrollTop + inset) scroller.scrollTop = top - inset;
			else if (top + rowH > scroller.scrollTop + scroller.clientHeight - 20) scroller.scrollTop = top + rowH - scroller.clientHeight + 20;
			place();
		}
		function destroy() { scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); }
		return { node: box, set: set, refresh: refresh, row: row, reveal: reveal, destroy: destroy, place: place };
	}

	// ---- Cover art -----------------------------------------------------------------------------
	// A square of colour from a hue, with an initial; or the video's thumbnail
	// when cover art is on and the id is a YouTube id.
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	function initialOf(s) {
		s = String(s || '').trim();
		var m = /[\p{L}\p{N}]/u.exec(s);
		return m ? m[0].toUpperCase() : '\u266A';
	}
	function swatch(hue, text, cls, sat) {
		var d = h('span', { class: 'ts-art ts-art-gen' + (cls ? ' ' + cls : ''), aria: { hidden: 'true' }, style: { '--h': String(Math.round(hue)), '--s': (sat == null ? 55 : sat) + '%' } });
		d.appendChild(h('span', { class: 'ts-art-letter', text: initialOf(text) }));
		return d;
	}
	function art(id, hue, text, cls, useImage, sat) {
		if (useImage && YT_ID.test(String(id || ''))) {
			var wrap = h('span', { class: 'ts-art' + (cls ? ' ' + cls : ''), aria: { hidden: 'true' }, style: { '--h': String(Math.round(hue)), '--s': (sat == null ? 55 : sat) + '%' } });
			var img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' });
			img.addEventListener('error', function () { wrap.classList.add('ts-art-gen'); if (img.parentNode) img.parentNode.removeChild(img); wrap.appendChild(h('span', { class: 'ts-art-letter', text: initialOf(text) })); });
			wrap.appendChild(img);
			return wrap;
		}
		return swatch(hue, text, cls, sat);
	}

	// ---- The player-safe zone ------------------------------------------------------------------
	// YouTube's terms: its player stays visible and is never covered. Dialogs,
	// sheets, toasts and progress chips lay out around it (CSS reads
	// --ts-safe-right on a wide window, where the player is in the right-hand
	// panel, and --ts-safe-top on a phone, where it is docked under the top bar),
	// and menus move off it. A second player (a scout) is parked, not covered.
	var safe = (function () {
		var players = [], scouts = [], raf = 0, ro = null;
		function rectOf(el) { if (!el || !el.isConnected) return null; var r = el.getBoundingClientRect(); return r.width && r.height ? r : null; }
		function live() { return players.filter(function (p) { return p.active(); }).map(function (p) { return rectOf(p.el); }).filter(Boolean); }
		function phone() { return !!(root.matchMedia && root.matchMedia('(max-width: 760px)').matches); }
		function update() {
			raf = 0;
			var right = 0, top = 0, vw = document.documentElement.clientWidth;
			live().forEach(function (r) {
				if (phone()) top = Math.max(top, Math.round(r.bottom));
				else right = Math.max(right, Math.round(vw - r.left + 8));
			});
			var de = document.documentElement;
			de.style.setProperty('--ts-safe-right', right + 'px');
			de.style.setProperty('--ts-safe-top', top + 'px');
		}
		function schedule() { if (!raf) raf = requestAnimationFrame(update); }
		function watch(el) {
			if (root.ResizeObserver) { if (!ro) ro = new ResizeObserver(schedule); ro.observe(el); }
		}
		function overlaps(a, r) { return a.x < r.right && a.x + a.w > r.left && a.y < r.bottom && a.y + a.h > r.top; }
		root.addEventListener('resize', schedule);
		return {
			// active(): whether the player counts now (built, visible)
			player: function (el, active) { players.push({ el: el, active: active || function () { return true; } }); watch(el); schedule(); },
			// park(): take the scout's iframe out because something will cover it
			scout: function (el, park) { scouts.push({ el: el, park: park }); return function () { scouts = scouts.filter(function (s) { return s.el !== el; }); }; },
			update: schedule,
			now: update,
			rects: function () { return live().map(function (r) { return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }); },
			// a box { x, y, w, h } moved off every protected player, inside the window
			avoid: function (b, vw, vh) {
				var hit = live().filter(function (r) { return overlaps(b, r); })[0];
				if (!hit) return b;
				var tries = [
					{ x: hit.left - b.w - 8, y: b.y },
					{ x: b.x, y: hit.bottom + 8 },
					{ x: b.x, y: hit.top - b.h - 8 },
					{ x: hit.right + 8, y: b.y }
				];
				for (var i = 0; i < tries.length; i++) {
					var t = { x: Math.max(8, Math.min(tries[i].x, vw - b.w - 8)), y: Math.max(8, Math.min(tries[i].y, vh - b.h - 8)), w: b.w, h: b.h };
					if (!live().some(function (r) { return overlaps(t, r); })) return t;
				}
				return b;
			},
			// before something covers part of the page: park every scout under it
			cover: function (rect) {
				scouts.forEach(function (s) { var r = rectOf(s.el); if (r && (!rect || overlaps({ x: rect.left, y: rect.top, w: rect.right - rect.left, h: rect.bottom - rect.top }, r))) s.park(); });
			}
		};
	})();

	// ---- A toast with an action (Undo) -----------------------------------------------------------
	var toastEl = null, toastTimer = 0;
	function toast(text, opts) {
		opts = opts || {};
		if (!toastEl) { toastEl = h('div', { class: 'ts-toast', role: 'status', aria: { live: 'polite' } }); document.body.appendChild(toastEl); }
		clearTimeout(toastTimer);
		clear(toastEl);
		toastEl.appendChild(h('span', { text: text }));
		if (opts.action) toastEl.appendChild(h('button', { class: 'ts-toast-btn', text: opts.action, on: { click: function () { hide(); opts.onAction(); } } }));
		toastEl.classList.add('is-on');
		function hide() { toastEl.classList.remove('is-on'); }
		toastTimer = setTimeout(hide, opts.ms || (opts.action ? 7000 : 3500));
	}

	// ---- Work in progress, shown: "Searching YouTube..." -------------------------------------------
	// A chip above the player bar (and the screen reader's status line) while
	// something runs; done() or fail() turns it into a toast. At most three.
	var jobsEl = null, jobs = [];
	function status(text) { var s = document.getElementById('status'); if (s) s.textContent = text || ''; }
	function job(text, opts) {
		opts = opts || {};
		if (!jobsEl) { jobsEl = h('div', { class: 'ts-jobs', aria: { hidden: 'true' } }); document.body.appendChild(jobsEl); }
		var label = h('span', { class: 'ts-job-text', text: text });
		var el = h('div', { class: 'ts-job' }, [h('span', { class: 'ts-spin' }), label]);
		var over = false;
		function end() { if (over) return; over = true; jobs = jobs.filter(function (j) { return j !== el; }); if (el.parentNode) el.parentNode.removeChild(el); }
		if (opts.onCancel) el.appendChild(h('button', { class: 'ts-job-x', text: 'Cancel', on: { click: function () { end(); status(''); opts.onCancel(); } } }));
		jobsEl.appendChild(el);
		jobs.push(el);
		while (jobs.length > 3) { var old = jobs.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
		status(text);
		return {
			set: function (t) { label.textContent = t; status(t); },
			done: function (t) { end(); status(t || ''); if (t) toast(t); },
			fail: function (t) { end(); status(t || ''); if (t) toast(t); }
		};
	}

	// ---- A small event bus between the page's parts ------------------------------------------------
	function bus() {
		var subs = {};
		return {
			on: function (name, fn) { (subs[name] || (subs[name] = [])).push(fn); return function () { subs[name] = (subs[name] || []).filter(function (f) { return f !== fn; }); }; },
			emit: function (name, data) { (subs[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { setTimeout(function () { throw e; }, 0); } }); }
		};
	}

	root.TrueShuffle = root.TrueShuffle || {};
	root.TrueShuffle.ui = {
		toast: toast, job: job, bus: bus(), safe: safe,
		h: h, add: add, clear: clear, icon: icon, iconBtn: iconBtn, setIcon: setIcon, PATHS: PATHS, EVENODD: EVENODD,
		btn: btn, btnState: btnState, split: split, badge: badge, check: check,
		parseHash: parseHash, link: link,
		openMenu: openMenu, closeMenu: closeMenu, openDialog: openDialog, dialogOpen: dialogOpen,
		virtualList: virtualList, art: art, swatch: swatch, initialOf: initialOf, YT_ID: YT_ID
	};
})(typeof self !== 'undefined' ? self : this);
