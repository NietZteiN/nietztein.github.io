// The Desk's Music sync view (#/music).
//
// True Shuffle (misc/101-true-shuffle/, same origin) keeps the owner's labels,
// ratings, plays and stations in this browser's IndexedDB and writes a sync
// bundle into its own key-value store. This view moves that bundle to and
// from the PRIVATE repository, so the GitHub token never leaves the Desk:
//
//   Push   kv 'sync:outbox'  ->  music/true-shuffle-sync.json (sha-checked)
//   Pull   music/true-shuffle-sync.json  ->  kv 'sync:inbox'
//
// True Shuffle merges the inbox the next time it opens or regains focus, then
// deletes it. Nothing is loaded from misc/: the IndexedDB part is in
// desk/musicsync.js (tested by desk/test/test-music.mjs), which never creates
// or upgrades True Shuffle's database. Every string from the bundle or the
// repository goes into the page as text.

(function () {
	'use strict';

	var VIEW = 'music';
	var ICON = 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';

	var HERE = (function () {
		var s = document.currentScript;
		return s && s.src ? s.src.replace(/views\/[^\/]*$/, '') : new URL('./', location.href).href;
	})();

	function loadSync() {
		if (window.DeskMusicSync) return Promise.resolve();
		var have = document.getElementById('desk-music-sync');
		if (have) return have.__ready;
		var s = document.createElement('script');
		s.id = 'desk-music-sync';
		s.src = HERE + 'musicsync.js';
		s.__ready = new Promise(function (resolve, reject) {
			s.onload = function () {
				resolve();
			};
			s.onerror = function () {
				s.parentNode.removeChild(s);
				reject(new Error('Could not load desk/musicsync.js. Check the connection and try again.'));
			};
		});
		document.head.appendChild(s);
		return s.__ready;
	}

	var M = null;

	function mount(el, api) {
		var ui = api.ui;
		var h = ui.el;
		var m = (M = { alive: true, local: null, remote: undefined });
		var idb = window.indexedDB;

		var loading = h('p', { class: 'muted', text: 'Loading...' });
		el.appendChild(loading);

		return loadSync().then(function () {
			if (!m.alive) return;
			el.removeChild(loading);
			var S = window.DeskMusicSync;

			function when(v) {
				return ui.date.long(v) + ', ' + ui.date.time(v);
			}
			function plural(n, one, many) {
				return n + ' ' + (n === 1 ? one : many);
			}
			function counts(sum) {
				return h('dl', { class: 'kv' }, [
					h('dt', { text: 'Saved' }),
					h('dd', { text: when(sum.savedAt) + ' (' + ui.date.ago(sum.savedAt) + ')' }),
					h('dt', { text: 'Labelled tracks' }),
					h('dd', { text: String(sum.labelled) }),
					h('dt', { text: 'Tracks with state' }),
					h('dd', { text: String(sum.withState) }),
					h('dt', { text: 'Stations' }),
					h('dd', { text: String(sum.stations) }),
					h('dt', { text: 'History entries' }),
					h('dd', { text: String(sum.history) }),
				]);
			}

			var localBox = h('div', { id: 'music-local' });
			var remoteBox = h('div', { id: 'music-remote' });
			var status = h('p', { class: 'small', id: 'music-status', role: 'status', 'aria-live': 'polite' });
			var pushBtn = ui.button('Push', { kind: 'primary', icon: 'M12 19V5M6 11l6-6 6 6', id: 'music-push', onClick: onPush });
			var pullBtn = ui.button('Pull', { icon: 'M12 5v14M6 13l6 6 6-6', id: 'music-pull', onClick: onPull });
			var againBtn = ui.button('Look again', { kind: 'quiet', icon: 'refresh', id: 'music-refresh', onClick: refresh });

			el.appendChild(
				h('section', { class: 'card', 'aria-labelledby': 'music-h-local' }, [h('div', { class: 'card-head' }, [h('h2', { id: 'music-h-local', text: 'True Shuffle in this browser' })]), localBox])
			);
			el.appendChild(
				h('section', { class: 'card', 'aria-labelledby': 'music-h-remote' }, [
					h('div', { class: 'card-head' }, [h('h2', { id: 'music-h-remote', text: 'The private repository' })]),
					h('p', { class: 'muted small mono', text: S.PATH }),
					remoteBox,
				])
			);
			el.appendChild(
				h('section', { class: 'card', 'aria-labelledby': 'music-h-sync' }, [
					h('div', { class: 'card-head' }, [h('h2', { id: 'music-h-sync', text: 'Sync' })]),
					h('div', { class: 'actions' }, [pushBtn, pullBtn, againBtn]),
					status,
					h('p', {
						class: 'muted small',
						text: 'Pull puts the repository copy in True Shuffle\'s inbox. True Shuffle merges it the next time it is opened or focused: ratings by time, plays as the larger count, labels applied, stations added.',
					}),
					h('p', { class: 'muted small', text: 'The bundle holds your own labels, ratings, plays and stations, not YouTube\'s video data.' }),
				])
			);

			function say(text, kind) {
				status.textContent = text || '';
				if (kind) status.setAttribute('data-kind', kind);
				else status.removeAttribute('data-kind');
			}

			function drawLocal() {
				ui.clear(localBox);
				var l = m.local;
				if (!l) {
					localBox.appendChild(h('p', { class: 'muted', text: 'Looking...' }));
				} else if (l.error) {
					localBox.appendChild(ui.errorBox(l.error, refresh));
				} else if (l.state === 'missing') {
					localBox.appendChild(ui.notice('True Shuffle has not been opened in this browser yet. Open it once on this device, then come back.'));
				} else if (l.state === 'empty') {
					localBox.appendChild(ui.notice('True Shuffle is here, but has not written a sync bundle yet. Open it and let it save, then look again.'));
				} else if (l.state === 'bad') {
					localBox.appendChild(ui.notice(l.error.message, 'warn'));
				} else {
					localBox.appendChild(counts(l.summary));
				}
				if (l && l.inbox) localBox.appendChild(h('p', { class: 'muted small', text: 'A pulled copy is waiting in the inbox: True Shuffle merges it the next time it is opened or focused.' }));
				pushBtn.disabled = !(l && l.state === 'ok') || m.remote === undefined;
				pullBtn.disabled = !(l && (l.state === 'ok' || l.state === 'empty' || l.state === 'bad')) || !m.remote || !!m.remote.error;
			}

			function drawRemote() {
				ui.clear(remoteBox);
				var r = m.remote;
				if (r === undefined) remoteBox.appendChild(h('p', { class: 'muted', text: 'Reading...' }));
				else if (r && r.failed) remoteBox.appendChild(ui.errorBox(r.failed, refresh));
				else if (r === null) remoteBox.appendChild(h('p', { class: 'muted', id: 'music-remote-none', text: 'Nothing pushed yet.' }));
				else if (r.error) remoteBox.appendChild(ui.notice(r.error.message, 'warn'));
				else remoteBox.appendChild(counts(r.summary));
			}

			function draw() {
				drawRemote();
				drawLocal();
			}

			function readLocal() {
				return S.readLocal(idb).then(
					function (l) {
						return l;
					},
					function (e) {
						return { error: e };
					}
				);
			}

			function readRemote() {
				return S.readRemote(api.gh).then(
					function (r) {
						return r;
					},
					function (e) {
						return { failed: e };
					}
				);
			}

			function refresh() {
				m.local = null;
				m.remote = undefined;
				draw();
				return Promise.all([readLocal(), readRemote()]).then(function (r) {
					if (!m.alive) return;
					m.local = r[0];
					m.remote = r[1];
					draw();
				});
			}

			function onPush() {
				var l = m.local;
				var r = m.remote;
				if (!l || l.state !== 'ok' || r === undefined || (r && r.failed)) return;
				var mine = l.bundle;
				var theirs = r && r.summary ? r.summary.savedAt : null;
				var body = [h('p', { text: 'This browser\'s copy, saved ' + when(mine.savedAt) + ', goes to ' + S.PATH + ' in the private repository.' })];
				var newer = false;
				if (r === null) body.push(h('p', { text: 'The repository has no copy yet.' }));
				else if (r.error) body.push(h('p', { text: 'It replaces a file there that this page cannot read.' }));
				else {
					body.push(h('p', { text: 'It replaces the repository copy, saved ' + when(theirs) + '.' }));
					newer = S.compare(theirs, mine.savedAt) > 0;
					if (newer) body.push(ui.notice('The repository copy is newer than this browser\'s. Pull first if you want to keep what it has.', 'warn'));
				}
				return ui.confirm({ title: 'Push to the repository?', body: h('div', {}, body), action: 'Push', danger: newer }).then(function (ok) {
					if (!ok || !m.alive) return;
					say('Pushing...');
					return ui.busy(
						pushBtn,
						S.push(api.gh, mine, r ? r.sha : null).then(
							function () {
								if (!m.alive) return;
								say('Pushed the copy saved ' + when(mine.savedAt) + '.', 'ok');
								ui.toast('Pushed to the repository.');
								return readRemote().then(function (again) {
									if (!m.alive) return;
									m.remote = again;
									draw();
								});
							},
							function (e) {
								if (!m.alive) return;
								if (e instanceof api.gh.errors.Conflict) say('The repository copy changed since this page read it, so nothing was overwritten. Look again, then decide.', 'bad');
								else say(e.message || String(e), 'bad');
							}
						)
					);
				});
			}

			function onPull() {
				say('Pulling...');
				return ui.busy(
					pullBtn,
					S.pull(api.gh, idb).then(
						function (res) {
							if (!m.alive) return;
							say(
								'The copy saved ' +
									when(res.summary.savedAt) +
									' (' +
									plural(res.summary.labelled, 'labelled track', 'labelled tracks') +
									', ' +
									plural(res.summary.stations, 'station', 'stations') +
									') is in True Shuffle\'s inbox. It merges it the next time it is opened or focused.',
								'ok'
							);
							return readLocal().then(function (l) {
								if (!m.alive) return;
								m.local = l;
								drawLocal();
							});
						},
						function (e) {
							if (!m.alive) return;
							say(e.message || String(e), 'bad');
						}
					)
				);
			}

			return refresh();
		});
	}

	function unmount() {
		if (M) M.alive = false;
		M = null;
	}

	if (window.Desk && window.Desk.registerView) {
		window.Desk.registerView({
			id: VIEW,
			title: 'Music',
			icon: ICON,
			order: 70,
			description: 'Sync True Shuffle with the private repository.',
			mount: mount,
			unmount: unmount,
		});
	}
})();
