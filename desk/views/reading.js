// Desk view "reading": the private reading log over the public library.
//
// The catalogue is public (assets/data/library.json, fetched from this site,
// with the site's own tables from misc/_kit/library.js). The log is private:
// reading/log.json in the private repository, read and written through
// api.store so that it works offline and queues its writes. The shape, the
// public projection and the statistics are in desk/readinglog.js.
//
// The only write to the public site is "Publish reading data": it builds
// assets/data/reading-log.json with readinglog.js's publicText() (only the
// ticked fields, never a note) and sends it with a ticket from
// api.ui.confirmPublish, after showing exactly what would become public.

(function (root) {
	'use strict';

	if (!root || !root.Desk || !root.document) return;

	var doc = root.document;
	var SPACE = 'reading';
	var CSS_HREF = 'views/notes-reading.css';
	var SAVE_DELAY = 1500;
	var PAGE = 60;
	var STAR = String.fromCharCode(0x2605);
	var DASH = String.fromCharCode(0x2013);

	function addStyles() {
		if (doc.querySelector('link[data-desk-css="notes-reading"]')) return;
		var link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = CSS_HREF;
		link.setAttribute('data-desk-css', 'notes-reading');
		doc.head.appendChild(link);
	}

	var loading = {};
	function loadScript(src, globalName) {
		if (root[globalName]) return Promise.resolve(root[globalName]);
		if (!loading[src]) {
			loading[src] = new Promise(function (resolve, reject) {
				var s = doc.createElement('script');
				s.src = src;
				s.onload = function () {
					if (root[globalName]) resolve(root[globalName]);
					else reject(new Error(src + ' loaded but did not define ' + globalName + '.'));
				};
				s.onerror = function () {
					delete loading[src];
					reject(new Error('Could not load ' + src + '. Check the connection and try again.'));
				};
				doc.head.appendChild(s);
			});
		}
		return loading[src];
	}

	var live = null;

	function mount(el, api) {
		addStyles();
		var ui = api.ui;
		var h = ui.el;
		var E = api.gh.errors;
		var gone = false;
		var RL = null;
		var L = null;

		var st = {
			books: [],
			byId: {},
			index: null,
			log: {},
			base: {}, // the log as GitHub last had it (for merging)
			savedText: null, // what was last handed to the store
			tab: 'reading',
			q: '',
			unit: '',
			genre: '',
			lang: '',
			shown: PAGE,
			current: null,
			catalogueCached: false,
			logCached: false,
			saving: null,
			again: false,
		};

		el.appendChild(h('h2', { class: 'sr-only', text: 'Reading' }));
		var top = h('div', { class: 'rd-top' });
		var main = h('div', { class: 'rd-main' });
		el.appendChild(top);
		el.appendChild(main);
		top.appendChild(h('p', { class: 'muted', text: 'Loading the library and the reading log...' }));

		// ---- loading ----

		function loadCatalogue() {
			return fetch(api.siteRoot + 'assets/data/library.json', { cache: 'no-cache', credentials: 'omit' })
				.then(function (r) {
					if (!r.ok) throw new Error('The library could not be fetched from the site (HTTP ' + r.status + ').');
					return r.json();
				})
				.then(function (data) {
					var books = Array.isArray(data && data.books) ? data.books : [];
					if (!books.length) throw new Error('The library file has no books in it.');
					api.store.put(SPACE, 'catalogue', { generated: data.generated || '', books: books }).catch(function () {});
					st.catalogueCached = false;
					return books;
				})
				.catch(function (err) {
					return api.store.get(SPACE, 'catalogue', null).then(function (c) {
						if (c && Array.isArray(c.books) && c.books.length) {
							st.catalogueCached = true;
							return c.books;
						}
						throw err instanceof TypeError ? new Error('The library could not be fetched: there seems to be no connection, and this device has no copy yet.') : err;
					});
				});
		}

		function loadLog() {
			return Promise.all([api.store.read(RL.LOG_PATH), api.store.get(SPACE, 'base', null)]).then(function (res) {
				var r = res[0];
				var baseText = res[1];
				var parsed = RL.parse(r ? r.text : '');
				st.log = parsed.log;
				st.logCached = !!(r && r.cached);
				if (r && r.pending) {
					st.base = baseText ? RL.parse(baseText).log : {};
				} else {
					st.base = parsed.log;
					api.store.put(SPACE, 'base', RL.serialize(parsed.log)).catch(function () {});
				}
				st.savedText = RL.serialize(st.log);
				return { dropped: parsed.dropped, conflict: !!(r && r.conflict) };
			});
		}

		function start() {
			ui.clear(top);
			ui.clear(main);
			top.appendChild(h('p', { class: 'muted', text: 'Loading the library and the reading log...' }));
			return Promise.all([loadScript('readinglog.js', 'DeskReadingLog'), loadScript(api.siteRoot + 'misc/_kit/library.js', 'ToyKitLibrary')])
				.then(function (mods) {
					RL = mods[0];
					L = mods[1];
					return Promise.all([loadCatalogue(), loadLog()]);
				})
				.then(function (res) {
					if (gone) return;
					st.books = res[0];
					st.byId = {};
					st.books.forEach(function (b) {
						st.byId[b.id] = b;
					});
					st.index = RL.makeIndex(st.books, { aliases: L.AUTHOR_ALIAS });
					// open on what is being read, else the log, else the library
					st.tab = RL.listByStatus(st.log, 'reading').length ? 'reading' : Object.keys(st.log).length ? 'log' : 'library';
					build();
					if (res[1].dropped.length) ui.toast(res[1].dropped.length + ' entries of reading/log.json were not understood and are left out (' + res[1].dropped.slice(0, 3).join(', ') + ').', { kind: 'warn' });
					if (res[1].conflict) mergeConflict();
					var want = api.params && api.params.book;
					if (want && st.byId[want]) openBook(want);
				})
				.catch(function (err) {
					if (gone) return;
					ui.clear(top);
					ui.clear(main);
					top.appendChild(
						ui.errorBox(new Error('The reading log could not be opened. ' + (err && err.message ? err.message : String(err))), function () {
							start();
						})
					);
				});
		}

		// ---- the page ----

		var els = {};

		function build() {
			ui.clear(top);
			ui.clear(main);
			els.status = h('div', { class: 'rd-flags' });
			els.current = h('section', { class: 'card rd-current', 'aria-labelledby': 'rd-current-h' });
			els.counts = h('div', { class: 'rd-counts', role: 'group', 'aria-label': 'Lists' });
			top.appendChild(els.status);
			top.appendChild(els.current);

			els.search = h('input', { type: 'search', class: 'input', id: 'reading-search', placeholder: 'Find a book: title or author', 'aria-label': 'Find a book by title or author', autocomplete: 'off', spellcheck: 'false' });
			els.unit = selectOf('Bookcase', 'reading-unit', unitOptions());
			els.genre = selectOf('Genre', 'reading-genre', genreOptions());
			els.lang = selectOf('Language', 'reading-lang', langOptions());
			els.listHead = h('p', { class: 'small muted rd-listhead', 'aria-live': 'polite', id: 'reading-listhead' });
			els.list = h('div', { class: 'rd-list', id: 'reading-list' });

			var ld = ui.listDetail(main, {
				label: 'Books',
				detailLabel: 'Book',
				onClose: function () {
					st.current = null;
					renderList();
				},
			});
			ld.el.classList.add('rd-ld');
			els.ld = ld;
			ld.list.appendChild(h('div', { class: 'rd-find' }, [els.search, h('div', { class: 'rd-facets' }, [els.unit, els.genre, els.lang])]));
			ld.list.appendChild(els.counts);
			ld.list.appendChild(els.listHead);
			ld.list.appendChild(els.list);
			els.publish = h('section', { class: 'card rd-publish', 'aria-labelledby': 'rd-publish-h' });
			ld.list.appendChild(els.publish);
			renderEmptyDetail();

			var timer = null;
			els.search.addEventListener('input', function () {
				clearTimeout(timer);
				timer = setTimeout(function () {
					st.q = els.search.value;
					st.shown = PAGE;
					renderList();
				}, 100);
			});
			els.search.addEventListener('keydown', function (e) {
				if (e.key === 'Escape' && els.search.value) {
					els.search.value = '';
					st.q = '';
					renderList();
				} else if (e.key === 'Enter') {
					var first = els.list.querySelector('button.row');
					if (first) first.click();
				}
			});
			[
				[els.unit, 'unit'],
				[els.genre, 'genre'],
				[els.lang, 'lang'],
			].forEach(function (pair) {
				pair[0].addEventListener('change', function () {
					st[pair[1]] = pair[0].value;
					st.shown = PAGE;
					renderList();
				});
			});
			renderAll();
		}

		function selectOf(label, id, options) {
			var s = h('select', { class: 'input', id: id, 'aria-label': label }, [h('option', { value: '', text: 'Every ' + label.toLowerCase() })]);
			options.forEach(function (o) {
				s.appendChild(h('option', { value: o.value, text: o.label }));
			});
			return s;
		}

		function countBy(fn) {
			var c = {};
			st.books.forEach(function (b) {
				var k = fn(b);
				if (k) c[k] = (c[k] || 0) + 1;
			});
			return c;
		}

		function unitOptions() {
			var c = countBy(function (b) {
				return b.u;
			});
			return L.UNITS.filter(function (u) {
				return c[u.k];
			}).map(function (u) {
				return { value: u.k, label: u.name + ' (' + c[u.k] + ')' };
			});
		}

		function genreOptions() {
			var c = countBy(function (b) {
				return b.g;
			});
			return Object.keys(L.GENRE_HUE)
				.filter(function (g) {
					return c[g];
				})
				.map(function (g) {
					return { value: g, label: g + ' (' + c[g] + ')' };
				});
		}

		function langOptions() {
			var c = countBy(function (b) {
				return b.l || '?';
			});
			return Object.keys(c)
				.sort(function (a, b) {
					return c[b] - c[a];
				})
				.map(function (k) {
					return { value: k, label: L.langName(k) + ' (' + c[k] + ')' };
				});
		}

		function renderAll() {
			renderFlags();
			renderCurrent();
			renderCounts();
			renderList();
			renderPublish();
			if (st.current) renderDetail();
		}

		function renderFlags() {
			ui.clear(els.status);
			if (st.catalogueCached) els.status.appendChild(ui.notice('The library comes from this device: the site could not be reached.', 'warn'));
			if (st.logCached) {
				els.status.appendChild(
					ui.notice(
						[
							h('p', { text: 'The reading log comes from this device: GitHub could not be reached. Changes are kept here and sent when the connection returns.' }),
							ui.button('Try again', {
								kind: 'quiet',
								onClick: function () {
									start();
								},
							}),
						],
						'warn'
					)
				);
			}
		}

		function bookName(id) {
			var b = st.byId[id];
			return b ? b.t : id + ' (not in the library)';
		}

		function authorOf(b) {
			return b && b.a ? b.a : '';
		}

		function placeOf(b) {
			if (!b) return '';
			var shelf = L.shelfLabel(b.s || '').label;
			return L.unitName(b.u) + (shelf ? ', ' + shelf : '');
		}

		function renderCurrent() {
			ui.clear(els.current);
			var ids = RL.listByStatus(st.log, 'reading');
			els.current.appendChild(h('h2', { id: 'rd-current-h', text: 'Currently reading' }));
			if (!ids.length) {
				els.current.appendChild(h('p', { class: 'muted small', text: 'Nothing at the moment. Find a book below and mark it "Reading".' }));
				return;
			}
			var ul = h('ul', { class: 'rd-reading' });
			ids.forEach(function (id) {
				var e = RL.get(st.log, id);
				var b = st.byId[id];
				var open = h('button', { type: 'button', class: 'rd-reading-open' }, [h('span', { class: 'rd-reading-t', text: bookName(id) }), h('span', { class: 'small muted', text: [authorOf(b), e.started ? 'since ' + ui.date.short(e.started) : ''].filter(Boolean).join(' · ') })]);
				open.addEventListener('click', function () {
					openBook(id);
				});
				var done = ui.button('Finished', { kind: 'quiet', icon: 'check', label: 'Mark "' + bookName(id) + '" as read' });
				done.addEventListener('click', function () {
					change(id, { status: 'read' });
					ui.toast('Marked as read: ' + bookName(id));
				});
				ul.appendChild(h('li', {}, [open, done]));
			});
			els.current.appendChild(ul);
		}

		var TABS = [
			{ id: 'reading', label: 'Reading' },
			{ id: 'want', label: 'Want to read' },
			{ id: 'read', label: 'Read' },
			{ id: 'abandoned', label: 'Abandoned' },
			{ id: 'log', label: 'In my log' },
			{ id: 'library', label: 'Whole library' },
		];

		function renderCounts() {
			ui.clear(els.counts);
			var s = RL.stats(st.log);
			var n = { reading: s.byStatus.reading, want: s.byStatus.want, read: s.byStatus.read, abandoned: s.byStatus.abandoned, log: s.total, library: st.books.length };
			TABS.forEach(function (t) {
				var on = st.tab === t.id;
				var b = h('button', { type: 'button', class: 'rd-tab' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', data: { tab: t.id } }, [h('span', { text: t.label }), h('span', { class: 'rd-tab-n', text: String(n[t.id]) })]);
				b.addEventListener('click', function () {
					st.tab = t.id;
					st.shown = PAGE;
					if (st.q) {
						st.q = '';
						els.search.value = '';
					}
					renderCounts();
					renderList();
				});
				els.counts.appendChild(b);
			});
		}

		function facetOk(b) {
			if (st.unit && b.u !== st.unit) return false;
			if (st.genre && b.g !== st.genre) return false;
			if (st.lang && (b.l || '?') !== st.lang) return false;
			return true;
		}

		function currentList() {
			var q = st.q.trim();
			if (q) {
				return {
					head: 'Searching the whole library',
					items: RL.search(st.index, q).filter(facetOk).map(function (b) {
						return b.id;
					}),
				};
			}
			if (st.tab === 'library') {
				return {
					head: 'The whole library, shelf by shelf',
					items: st.books.filter(facetOk).map(function (b) {
						return b.id;
					}),
				};
			}
			var ids;
			if (st.tab === 'log') {
				ids = Object.keys(st.log).sort(function (a, b) {
					var x = bookName(a).toLowerCase();
					var y = bookName(b).toLowerCase();
					return x < y ? -1 : x > y ? 1 : 0;
				});
			} else ids = RL.listByStatus(st.log, st.tab);
			var tab = TABS.filter(function (t) {
				return t.id === st.tab;
			})[0];
			return {
				head: tab.label,
				items: ids.filter(function (id) {
					var b = st.byId[id];
					return b ? facetOk(b) : !st.unit && !st.genre && !st.lang;
				}),
			};
		}

		function badgeFor(id) {
			if (!RL.inLog(st.log, id)) return null;
			var e = RL.get(st.log, id);
			var label = e.status ? RL.STATUS_LABEL[e.status] : 'Note';
			if (e.rating) label += ' ' + e.rating + STAR;
			return { text: label, kind: e.status === 'reading' ? 'accent' : e.status === 'read' ? 'ok' : e.status === 'abandoned' ? 'bad' : '' };
		}

		function renderList() {
			if (!els.list) return;
			ui.clear(els.list);
			var res = currentList();
			var facets = [st.unit ? L.unitName(st.unit) : '', st.genre, st.lang ? L.langName(st.lang) : ''].filter(Boolean);
			els.listHead.textContent = res.head + (facets.length ? ' · ' + facets.join(' · ') : '') + ': ' + (res.items.length === 1 ? '1 book' : res.items.length + ' books');
			if (!res.items.length) {
				var msg = st.q ? 'No book matches "' + st.q.trim() + '".' : st.tab === 'library' || st.tab === 'log' ? (st.tab === 'log' ? 'The log is empty. Find a book and give it a status.' : 'No book matches these filters.') : 'No book here yet.';
				els.list.appendChild(h('p', { class: 'muted rd-empty', text: msg }));
				return;
			}
			var ul = h('ul', { class: 'rd-rows' });
			res.items.slice(0, st.shown).forEach(function (id) {
				var b = st.byId[id];
				var badge = badgeFor(id);
				var r = ui.row({
					title: bookName(id),
					meta: [authorOf(b), b && b.y != null ? L.yearText(b.y) : '', placeOf(b)].filter(Boolean).join(' · '),
					badge: badge ? badge.text : '',
					badgeKind: badge ? badge.kind : '',
					current: st.current === id,
					onClick: function () {
						openBook(id);
					},
				});
				r.setAttribute('data-id', id);
				ul.appendChild(h('li', {}, r));
			});
			els.list.appendChild(ul);
			if (res.items.length > st.shown) {
				var more = ui.button('Show more (' + (res.items.length - st.shown) + ' left)', { kind: 'quiet', id: 'reading-more' });
				more.addEventListener('click', function () {
					st.shown += PAGE;
					renderList();
				});
				els.list.appendChild(more);
			}
		}

		// ---- one book ----

		function renderEmptyDetail() {
			ui.clear(els.ld.detail);
			els.ld.detail.appendChild(h('div', { class: 'nr-placeholder muted' }, [ui.icon('reading', 28), h('p', { text: 'Find a book to set its status, dates, rating and a private note.' })]));
		}

		function openBook(id) {
			st.current = id;
			renderDetail();
			renderList();
			els.ld.open();
			// on a phone the detail sits below the cards at the top: bring it up
			if (els.ld.isNarrow() && els.ld.el.scrollIntoView) els.ld.el.scrollIntoView({ block: 'start' });
		}

		function renderDetail() {
			var id = st.current;
			var host = els.ld.detail;
			ui.clear(host);
			if (!id) return renderEmptyDetail();
			var b = st.byId[id];
			var e = RL.get(st.log, id);

			var statusGroup = h('div', { class: 'rd-status', role: 'group', 'aria-label': 'Status' });
			RL.STATUSES.forEach(function (s) {
				var on = e.status === s;
				var btn = h('button', { type: 'button', class: 'rd-seg' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', data: { status: s }, text: RL.STATUS_LABEL[s] });
				btn.addEventListener('click', function () {
					change(id, { status: on ? null : s });
				});
				statusGroup.appendChild(btn);
			});

			var started = h('input', { type: 'date', class: 'input', id: 'reading-started', value: e.started || '', min: '1900-01-01', max: '2199-12-31' });
			var finished = h('input', { type: 'date', class: 'input', id: 'reading-finished', value: e.finished || '', min: '1900-01-01', max: '2199-12-31' });
			started.addEventListener('change', function () {
				change(id, { started: started.value || null });
			});
			finished.addEventListener('change', function () {
				change(id, { finished: finished.value || null });
			});

			var stars = h('div', { class: 'rd-stars', role: 'group', 'aria-label': 'Rating' });
			[1, 2, 3, 4, 5].forEach(function (n) {
				var on = e.rating !== null && n <= e.rating;
				var btn = h('button', { type: 'button', class: 'rd-star' + (on ? ' is-on' : ''), 'aria-pressed': e.rating === n ? 'true' : 'false', 'aria-label': n + ' of 5', data: { rating: String(n) }, text: STAR });
				btn.addEventListener('click', function () {
					change(id, { rating: e.rating === n ? null : n });
				});
				stars.appendChild(btn);
			});
			var noRating = h('button', { type: 'button', class: 'rd-norating btn btn-quiet', 'aria-pressed': e.rating === null ? 'true' : 'false', text: 'No rating' });
			noRating.addEventListener('click', function () {
				change(id, { rating: null });
			});

			var note = h('textarea', { class: 'input rd-note', id: 'reading-note', rows: '5', spellcheck: 'true' });
			note.value = e.note;
			var noteTimer = null;
			note.addEventListener('input', function () {
				clearTimeout(noteTimer);
				api.dirty(true);
				noteTimer = setTimeout(function () {
					change(id, { note: note.value }, { keepDetail: true });
				}, 500);
			});
			note.addEventListener('blur', function () {
				clearTimeout(noteTimer);
				if (note.value !== RL.get(st.log, id).note) change(id, { note: note.value }, { keepDetail: true });
			});

			var pub = h('fieldset', { class: 'rd-public' }, [h('legend', { text: 'Public when you publish' }), h('p', { class: 'small muted', text: 'Only ticked fields can ever reach the public site, and only when you press "Publish reading data". The note never does.' })]);
			[
				['status', 'Status'],
				['dates', 'Dates'],
				['rating', 'Rating'],
			].forEach(function (pair) {
				var box = h('input', { type: 'checkbox', id: 'reading-public-' + pair[0], checked: e.public[pair[0]] });
				box.addEventListener('change', function () {
					var p = {};
					p[pair[0]] = box.checked;
					change(id, { public: p }, { keepDetail: true });
				});
				pub.appendChild(h('label', { class: 'check', for: box.id }, [box, pair[1]]));
			});
			if (!RL.inLog(st.log, id)) {
				Array.prototype.forEach.call(pub.querySelectorAll('input'), function (i) {
					i.disabled = true;
				});
				pub.appendChild(h('p', { class: 'small muted', text: 'Give the book a status first.' }));
			}

			var remove = ui.button('Remove from the log', { kind: 'danger', icon: 'trash', id: 'reading-remove' });
			remove.hidden = !RL.inLog(st.log, id);
			remove.addEventListener('click', function () {
				var before = st.log[id];
				change(id, null);
				ui.toast('Removed from the log. Undo with the button below the book.', { kind: 'warn' });
				var undo = ui.button('Undo', { kind: 'quiet', id: 'reading-undo' });
				undo.addEventListener('click', function () {
					st.log = RL.put(st.log, id, before);
					afterChange(id);
				});
				var slot = els.ld.detail.querySelector('.rd-undo-slot');
				if (slot) {
					slot.appendChild(undo);
					undo.focus({ preventScroll: true });
				}
			});

			var kv = h('dl', { class: 'kv rd-kv' });
			var add = function (k, v) {
				if (!v) return;
				kv.appendChild(h('dt', { text: k }));
				kv.appendChild(h('dd', { text: v }));
			};
			if (b) {
				add('Where', placeOf(b));
				add('Language', L.langName(b.l));
				add('Genre', b.g);
				add('First published', b.yr || (b.y != null ? L.yearText(b.y) : ''));
				add('Publisher', b.pub);
			}

			host.appendChild(
				h('article', { class: 'rd-book', data: { id: id } }, [
					h('h2', { class: 'rd-title', id: 'reading-title', text: bookName(id) }),
					b && b.a ? h('p', { class: 'rd-author', text: b.a }) : null,
					b && b.d ? h('p', { class: 'small muted rd-desc', text: b.d }) : null,
					kv,
					h('div', { class: 'field' }, [h('div', { class: 'label', text: 'Status' }), statusGroup]),
					h('div', { class: 'rd-dates' }, [ui.field('Started', started), ui.field('Finished', finished)]),
					h('div', { class: 'field' }, [h('div', { class: 'label', text: 'Rating' }), h('div', { class: 'rd-rating' }, [stars, noRating])]),
					ui.field('Private note', note, 'Kept in the private repository. Never published.'),
					pub,
					h('p', { class: 'small muted rd-savestate', id: 'reading-savestate', 'aria-live': 'polite', text: saveLine() }),
					h('div', { class: 'actions' }, [remove, h('span', { class: 'rd-undo-slot' })]),
				])
			);
		}

		// ---- changing the log ----

		function change(id, patch, opts) {
			if (patch === null) st.log = RL.remove(st.log, id);
			else st.log = RL.set(st.log, id, patch, ui.date.iso());
			afterChange(id, opts);
		}

		function afterChange(id, opts) {
			api.dirty(true);
			renderCurrent();
			renderCounts();
			renderList();
			renderPublish();
			if (st.current === id) {
				if (opts && opts.keepDetail) {
					var s = els.ld.detail.querySelector('#reading-savestate');
					if (s) s.textContent = 'Saving soon...';
					var rm = els.ld.detail.querySelector('#reading-remove');
					if (rm) rm.hidden = !RL.inLog(st.log, id);
				} else {
					var focusKey = doc.activeElement && doc.activeElement.dataset ? doc.activeElement.dataset.status || (doc.activeElement.dataset.rating ? 'r' + doc.activeElement.dataset.rating : '') : '';
					var focusId = doc.activeElement && doc.activeElement.id;
					renderDetail();
					var again = focusKey ? els.ld.detail.querySelector(focusKey.charAt(0) === 'r' && /^r\d$/.test(focusKey) ? '[data-rating="' + focusKey.slice(1) + '"]' : '[data-status="' + focusKey + '"]') : focusId ? els.ld.detail.querySelector('#' + focusId) : null;
					if (again) again.focus({ preventScroll: true });
				}
			}
			scheduleSave();
		}

		var saveTimer = null;
		function scheduleSave() {
			clearTimeout(saveTimer);
			api.store.put(SPACE, 'unsent', RL.serialize(st.log)).catch(function () {});
			saveTimer = setTimeout(saveNow, SAVE_DELAY);
		}

		function saveLine() {
			if (st.saving) return 'Saving...';
			if (st.lastError) return st.lastError;
			if (st.queued) return 'Kept on this device; it goes to GitHub when the connection returns.';
			if (RL.serialize(st.log) !== st.savedText) return 'Saving soon...';
			return st.lastSaved ? 'Saved ' + ui.date.ago(st.lastSaved) + '.' : 'Saved.';
		}

		function showSaveState() {
			var s = els.ld && els.ld.detail.querySelector('#reading-savestate');
			if (s) s.textContent = saveLine();
		}

		function saveNow() {
			clearTimeout(saveTimer);
			if (st.saving) {
				st.again = true;
				return st.saving;
			}
			var text = RL.serialize(st.log);
			if (text === st.savedText) {
				api.dirty(false);
				return Promise.resolve();
			}
			var mine = st.log;
			st.lastError = '';
			st.saving = api.store
				.save(RL.LOG_PATH, text, { message: 'Update the reading log' })
				.then(
					function (r) {
						st.savedText = text;
						st.queued = r.state === 'queued';
						if (!st.queued) {
							st.base = mine;
							st.lastSaved = new Date();
							api.store.put(SPACE, 'base', text).catch(function () {});
						}
						api.store.del(SPACE, 'unsent').catch(function () {});
					},
					function (err) {
						if (err instanceof E.Conflict) return mergeConflict();
						st.lastError = 'Not saved: ' + explain(err);
						ui.toast(st.lastError, { kind: 'bad' });
					}
				)
				.then(function () {
					st.saving = null;
					if (gone) return;
					api.dirty(RL.serialize(st.log) !== st.savedText);
					showSaveState();
					if (st.again) {
						st.again = false;
						return saveNow();
					}
				});
			showSaveState();
			return st.saving;
		}

		// GitHub has a newer log (another device). Take it, put this device's
		// own changes on top, and save that.
		function mergeConflict() {
			return api.gh
				.read('private', RL.LOG_PATH)
				.then(function (theirs) {
					var their = theirs ? RL.parse(theirs.text).log : {};
					var ids = RL.changedIds(st.base, st.log);
					var merged = RL.merge(their, st.log, ids);
					var text = RL.serialize(merged);
					return api.store.save(RL.LOG_PATH, text, { message: 'Update the reading log', sha: theirs ? theirs.sha : null }).then(function (r) {
						st.log = merged;
						st.savedText = text;
						st.queued = r.state === 'queued';
						if (!st.queued) {
							st.base = merged;
							st.lastSaved = new Date();
							api.store.put(SPACE, 'base', text).catch(function () {});
						}
						if (!gone) {
							renderAll();
							ui.toast('The log had changed on another device: both sets of changes are kept.');
						}
					});
				})
				.catch(function (err) {
					st.lastError = 'The log changed on another device and could not be merged: ' + explain(err) + ' Your version is kept on this device; Home lets you choose which one wins.';
					if (!gone) ui.toast(st.lastError, { kind: 'bad' });
				});
		}

		function explain(err) {
			if (err instanceof E.Forbidden) return 'GitHub refused' + (err.permission ? ' (the token needs "' + err.permission + '")' : '') + ': ' + err.message;
			return err && err.message ? err.message : String(err);
		}

		// ---- publishing ----

		function knownIds() {
			return st.books.map(function (b) {
				return b.id;
			});
		}

		function renderPublish() {
			if (!els.publish) return;
			ui.clear(els.publish);
			var sum = RL.publicSummary(st.log, { knownIds: knownIds() });
			var last = api.settings.get('reading.published', null);
			els.publish.appendChild(h('h2', { id: 'rd-publish-h', text: 'Public reading data' }));
			els.publish.appendChild(
				h('p', {
					class: 'small',
					text: sum.books
						? sum.books + (sum.books === 1 ? ' book has' : ' books have') + ' a ticked public box (' + [sum.status + ' status', sum.dates + ' dates', sum.rating + ' rating'].join(', ') + '). Nothing changes on the site until you publish.'
						: 'Nothing in the log is ticked as public. By default everything stays private.',
				})
			);
			if (last && last.at) els.publish.appendChild(h('p', { class: 'small muted', text: 'Last published ' + ui.date.ago(last.at) + ' (' + (last.books === 1 ? '1 book' : (last.books || 0) + ' books') + ').' }));
			var go = ui.button('Publish reading data...', { kind: 'primary', icon: 'globe', id: 'reading-publish' });
			go.addEventListener('click', function () {
				publish(go);
			});
			var bulk = h('details', { class: 'rd-bulk' }, [h('summary', { text: 'Tick or untick for every book in the log' })]);
			[
				['status', 'Make every status public'],
				['dates', 'Make every date public'],
				['rating', 'Make every rating public'],
			].forEach(function (pair) {
				bulk.appendChild(
					ui.button(pair[1], {
						kind: 'quiet',
						onClick: function () {
							bulkTick(pair[0], true);
						},
					})
				);
			});
			bulk.appendChild(
				ui.button('Make nothing public', {
					kind: 'quiet',
					id: 'reading-untick-all',
					onClick: function () {
						bulkTick(null, false);
					},
				})
			);
			els.publish.appendChild(h('div', { class: 'actions' }, [go]));
			els.publish.appendChild(bulk);
		}

		function bulkTick(field, value) {
			var ids = Object.keys(st.log);
			if (!ids.length) {
				ui.toast('The log is empty.', { kind: 'warn' });
				return;
			}
			var what = field ? 'the ' + (field === 'dates' ? 'dates' : field) + ' public box' : 'every public box';
			ui.confirm({
				title: value ? 'Tick ' + what + '?' : 'Untick everything?',
				body: (value ? 'Ticks ' : 'Unticks ') + what + ' on ' + ids.length + (ids.length === 1 ? ' book' : ' books') + '. Nothing is published until you press "Publish reading data".',
				action: value ? 'Tick' : 'Untick',
			}).then(function (ok) {
				if (!ok) return;
				var log = st.log;
				ids.forEach(function (id) {
					var p = field ? {} : { status: false, dates: false, rating: false };
					if (field) p[field] = value;
					log = RL.set(log, id, { public: p });
				});
				st.log = log;
				afterChange(st.current);
			});
		}

		function publish(btn) {
			var text = RL.publicText(st.log, { knownIds: knownIds() });
			var next = RL.publicProjection(st.log, { knownIds: knownIds() });
			var sum = RL.publicSummary(st.log, { knownIds: knownIds() });
			var work = api.gh.read('site', RL.PUBLIC_PATH).then(
				function (existing) {
					if (existing && existing.text === text) {
						ui.toast('The public file already says exactly this. Nothing to publish.');
						return;
					}
					if (!existing && !sum.books) {
						ui.toast('Nothing is ticked as public, and the site has no reading data: there is nothing to publish.', { kind: 'warn' });
						return;
					}
					var prev = existing ? RL.readPublic(existing.text) : null;
					var diff = RL.diffPublic(prev, next);
					return ui
						.confirmPublish({
							title: 'Publish reading data?',
							paths: [{ path: RL.PUBLIC_PATH, note: existing ? 'replaced' : 'new file' }],
							summary: summaryNode(sum, diff, !!existing),
							previewNode: previewNode(next, text),
							action: 'Publish',
						})
						.then(function (ticket) {
							if (!ticket) return;
							return api.gh
								.write('site', RL.PUBLIC_PATH, text, {
									message: 'Update the public reading data (' + (sum.books === 1 ? '1 book' : sum.books + ' books') + ')',
									sha: existing ? existing.sha : undefined,
									ticket: ticket,
								})
								.then(function () {
									api.settings.set('reading.published', { at: new Date().toISOString(), books: sum.books });
									renderPublish();
									ui.toast('Published. The site shows it within a minute or two.');
								});
						});
				}
			);
			ui.busy(
				btn,
				work.catch(function (err) {
					var msg = err instanceof E.Conflict ? 'The public file changed meanwhile. Press Publish again to see the new state.' : err instanceof E.Offline ? 'There is no connection: publishing needs one. Nothing was sent.' : 'Nothing was published: ' + explain(err);
					var box = ui.errorBox(new Error(msg), function () {
						if (box.parentNode) box.parentNode.removeChild(box);
						publish(btn);
					});
					els.publish.appendChild(box);
				})
			);
		}

		function summaryNode(sum, diff, exists) {
			var parts = [];
			parts.push(h('p', { class: 'publish-summary', text: sum.books ? sum.books + (sum.books === 1 ? ' book becomes' : ' books become') + ' public, with: status for ' + sum.status + ', dates for ' + sum.dates + ', rating for ' + sum.rating + '.' : 'No book will be public: the file on the site is emptied.' }));
			parts.push(h('p', { class: 'small', text: 'Stays private: ' + (sum.keptPrivate ? sum.keptPrivate + (sum.keptPrivate === 1 ? ' book' : ' books') + ' of the log with nothing ticked, ' : '') + 'every field whose box is not ticked, and ' + (sum.notesKeptPrivate === 1 ? 'the one private note' : 'all ' + sum.notesKeptPrivate + ' private notes') + '.' }));
			if (exists) parts.push(h('p', { class: 'small muted', text: 'Compared with the site now: ' + diff.added.length + ' added, ' + diff.changed.length + ' changed, ' + diff.removed.length + ' removed, ' + diff.same + ' the same.' }));
			if (sum.unknown.length) parts.push(h('p', { class: 'small muted', text: sum.unknown.length + ' ticked ' + (sum.unknown.length === 1 ? 'entry is' : 'entries are') + ' not in the library and stay out.' }));
			return h('div', {}, parts);
		}

		function previewNode(proj, text) {
			var ids = Object.keys(proj.books);
			var table = h('table', { class: 'rd-ptable' }, [h('thead', {}, h('tr', {}, [h('th', { text: 'Book' }), h('th', { text: 'Status' }), h('th', { text: 'Dates' }), h('th', { text: 'Rating' })]))]);
			var tb = h('tbody');
			ids.forEach(function (id) {
				var r = proj.books[id];
				tb.appendChild(
					h('tr', {}, [
						h('td', { text: bookName(id) }),
						h('td', { text: r.status ? RL.STATUS_LABEL[r.status] : DASH }),
						h('td', { text: r.started || r.finished ? (r.started || '?') + ' ' + DASH + ' ' + (r.finished || '') : DASH }),
						h('td', { text: r.rating ? r.rating + STAR : DASH }),
					])
				);
			});
			table.appendChild(tb);
			return h('div', { class: 'rd-preview' }, [
				ids.length ? h('div', { class: 'rd-ptable-wrap' }, table) : null,
				h('details', {}, [h('summary', { text: 'The exact file (' + text.length + ' bytes)' }), h('pre', { class: 'mono small rd-pre', text: text })]),
			]);
		}

		// ---- keyboard: "/" finds a book ----

		function onKey(e) {
			if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
			var t = e.target;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
			if (!els.search || doc.querySelector('dialog[open]')) return;
			e.preventDefault();
			if (els.ld.isOpen() && els.ld.isNarrow()) els.ld.close();
			els.search.focus();
		}
		doc.addEventListener('keydown', onKey);

		api.on('lock', function () {
			clearTimeout(saveTimer);
			if (RL && RL.serialize(st.log) !== st.savedText) return api.store.put(SPACE, 'unsent', RL.serialize(st.log));
			return null;
		});

		live = {
			open: function (id) {
				if (RL && st.byId[id]) openBook(id);
			},
			stop: function () {
				doc.removeEventListener('keydown', onKey);
				clearTimeout(saveTimer);
				if (RL && RL.serialize(st.log) !== st.savedText) saveNow();
				gone = true;
			},
		};

		// A change made just before a lock or a crash that never reached the store.
		return start().then(function () {
			if (gone || !RL) return;
			return api.store.get(SPACE, 'unsent', null).then(function (text) {
				if (!text || gone) return;
				var mine = RL.parse(text).log;
				var ids = RL.changedIds(st.log, mine);
				if (!ids.length) {
					api.store.del(SPACE, 'unsent').catch(function () {});
					return;
				}
				st.log = RL.merge(st.log, mine, ids);
				renderAll();
				scheduleSave();
				ui.toast('Changes to ' + (ids.length === 1 ? 'one book' : ids.length + ' books') + ' that had not been sent yet are being saved now.');
			});
		});
	}

	root.Desk.registerView({
		id: 'reading',
		title: 'Reading',
		icon: 'reading',
		order: 30,
		description: 'What you are reading, and the reading log.',
		mount: mount,
		update: function (params) {
			if (live && params && params.book) live.open(params.book);
		},
		unmount: function () {
			if (live) live.stop();
			live = null;
		},
	});
})(typeof window !== 'undefined' ? window : null);
