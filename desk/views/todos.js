// The Desk's To-dos view (#/todos).
//
//   - The owner's own list, kept as todos.json in the PRIVATE repository: quick
//     add ("#tag", "due:2026-10-12", a link), edit, reorder, done, filter by
//     tag ("decisions" first: the things only he can decide), import and export
//     as JSON. Nothing of the list is in this public file.
//   - Drafts at a glance: how many, the one untouched longest, each opening in
//     the Write view.
//   - The stories board: one row per publication (assets/data/publications.json)
//     and per published post (blog/index.json) with its Paper Theatre story
//     (misc/55-paper-theatre/stories/index.json), its status and verify flag,
//     and a link to the story on the live site. Titles and venues verbatim.
//
// The pure parts (parsing, merging, reordering, the board) are in desk/checks.js
// and tested by desk/test/test-checks.mjs. Every string from a file goes into
// the page as text.

(function () {
	'use strict';

	var VIEW = 'todos';
	var PATH = 'todos.json';

	var HERE = (function () {
		var s = document.currentScript;
		return s && s.src ? s.src.replace(/views\/[^\/]*$/, '') : new URL('./', location.href).href;
	})();

	// desk/checks.js and the views' stylesheet, loaded once from this site.
	function loadOnce(id, make) {
		var have = document.getElementById(id);
		if (have) return have.__ready || Promise.resolve();
		var node = make();
		node.id = id;
		node.__ready = new Promise(function (resolve, reject) {
			node.onload = function () {
				resolve();
			};
			node.onerror = function () {
				node.parentNode.removeChild(node);
				reject(new Error('Could not load ' + (node.src || node.href).replace(HERE, 'desk/') + '. Check the connection and try again.'));
			};
		});
		document.head.appendChild(node);
		return node.__ready;
	}

	function loadDeps() {
		var css = loadOnce('desk-th-css', function () {
			var l = document.createElement('link');
			l.rel = 'stylesheet';
			l.href = HERE + 'views/todos-health.css';
			return l;
		});
		var js = window.DeskChecks
			? Promise.resolve()
			: loadOnce('desk-th-checks', function () {
					var s = document.createElement('script');
					s.src = HERE + 'checks.js';
					return s;
			  });
		return Promise.all([css.catch(function () {}), js]);
	}

	// One mount's state. Dropped at unmount.
	var M = null;

	function mount(el, api) {
		var ui = api.ui;
		var h = ui.el;
		var m = (M = {
			api: api,
			items: [],
			base: [],
			loaded: false,
			saveTimer: null,
			saving: null,
			lastText: null,
			filter: { tag: '', showDone: false },
			alive: true,
			urls: [],
		});

		var loading = h('p', { class: 'muted', text: 'Loading the to-do list...' });
		el.appendChild(loading);

		return loadDeps().then(function () {
			if (!m.alive) return;
			el.removeChild(loading);
			var C = window.DeskChecks;
			var T = C.todos;
			try {
				m.filter.tag = api.settings.get('todos.tag', '') || '';
				m.filter.showDone = !!api.settings.get('todos.showDone', false);
			} catch (e) {
				/* settings not ready: the defaults */
			}

			// ---- the list card ------------------------------------------------
			var quick = h('input', { class: 'input', id: 'todo-quick', type: 'text', autocomplete: 'off', placeholder: 'Add a to-do', 'aria-describedby': 'todo-quick-hint', maxlength: '2000' });
			var addBtn = ui.button('Add', { kind: 'primary', icon: 'plus', type: 'submit', id: 'todo-add' });
			var addForm = h('form', { class: 'th-add', on: { submit: onAdd } }, [h('label', { class: 'sr-only', for: 'todo-quick', text: 'New to-do' }), quick, addBtn]);
			var hint = h('p', { class: 'th-hint', id: 'todo-quick-hint', text: 'Write #tag for a tag (#decisions for what only you can decide), due:2026-10-12 for a date, and paste a link if it needs one.' });

			var tagSel = h('select', { class: 'input', id: 'todo-filter', on: { change: onFilter } });
			var doneBox = h('input', { type: 'checkbox', id: 'todo-showdone', checked: m.filter.showDone, on: { change: onFilter } });
			var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, id: 'todo-import-file', on: { change: onImportFile } });
			var tools = h('div', { class: 'th-tools' }, [
				h('label', { class: 'sr-only', for: 'todo-filter', text: 'Show the to-dos tagged' }),
				tagSel,
				h('label', { class: 'check', for: 'todo-showdone' }, [doneBox, h('span', { text: 'Show done' })]),
				h('span', { class: 'th-spacer' }),
				ui.button('Import', { kind: 'quiet', id: 'todo-import', onClick: function () {
					fileInput.value = '';
					fileInput.click();
				} }),
				ui.button('Export', { kind: 'quiet', id: 'todo-export', onClick: onExport }),
				fileInput,
			]);
			var status = h('p', { class: 'th-status', id: 'todo-status', role: 'status', 'aria-live': 'polite' });
			var listBox = h('div', { id: 'todo-list-box' });
			var count = h('span', { class: 'muted small', id: 'todo-count' });
			var listCard = h('section', { class: 'card', 'aria-labelledby': 'todo-h-list' }, [h('div', { class: 'card-head' }, [h('h2', { id: 'todo-h-list', text: 'To-dos' }), count]), addForm, hint, tools, status, listBox]);

			// ---- drafts and the board ------------------------------------------
			var draftsBox = h('div', { id: 'todo-drafts' }, h('p', { class: 'th-empty', text: 'Looking at drafts/...' }));
			var draftsCard = h('section', { class: 'card', 'aria-labelledby': 'todo-h-drafts' }, [h('div', { class: 'card-head' }, [h('h2', { id: 'todo-h-drafts', text: 'Drafts' }), ui.button('', { kind: 'quiet', icon: 'refresh', label: 'Look at the drafts again', class: 'btn-small', onClick: loadDrafts })]), draftsBox]);
			var boardBox = h('div', { id: 'todo-board' }, h('p', { class: 'th-empty', text: 'Reading the site\'s indexes...' }));
			var boardCard = h('section', { class: 'card', 'aria-labelledby': 'todo-h-board' }, [
				h('div', { class: 'card-head' }, [h('h2', { id: 'todo-h-board', text: 'Stories' }), ui.button('', { kind: 'quiet', icon: 'refresh', label: 'Read the indexes again', class: 'btn-small', onClick: function () {
					loadBoard(true);
				} })]),
				h('p', { class: 'th-sub', text: 'Each publication and published post, and its Paper Theatre story.' }),
				boardBox,
			]);

			el.appendChild(listCard);
			el.appendChild(draftsCard);
			el.appendChild(boardCard);

			function say(text, kind) {
				status.textContent = text || '';
				if (kind) status.setAttribute('data-kind', kind);
				else status.removeAttribute('data-kind');
			}

			// ---- reading and saving --------------------------------------------
			function loadList() {
				ui.clear(listBox);
				listBox.appendChild(h('p', { class: 'th-empty', text: 'Reading todos.json...' }));
				return api.store.read(PATH).then(
					function (r) {
						if (!m.alive) return;
						if (r && r.conflict) return settleConflict(r);
						var parsed = r ? T.parse(r.text) : { items: [], problems: [] };
						if (parsed.invalid) {
							m.loaded = false;
							ui.clear(listBox);
							listBox.appendChild(ui.errorBox(new Error('todos.json in the private repository could not be read: ' + parsed.problems[0] + ' Fix the file on GitHub, or import a good copy (it replaces the file).'), loadList));
							m.loaded = 'broken';
							return;
						}
						m.items = parsed.items;
						m.lastText = r ? r.text : null;
						m.loaded = true;
						return api.store.get(VIEW, 'base', null).then(function (b) {
							if (!m.alive) return;
							// The base for a merge: what GitHub last had, as far as this device knows.
							if (r && !r.pending) {
								m.base = parsed.items;
								api.store.put(VIEW, 'base', parsed.items);
							} else m.base = Array.isArray(b) ? b : [];
							if (r && r.cached) say('GitHub could not be reached; this is the copy kept on this device. Changes are kept here and sent when the connection is back.', 'warn');
							else if (r && r.pending) say('Some changes have not reached GitHub yet; they are sent when the connection is back.', 'warn');
							else if (parsed.problems.length) say(parsed.problems.join(' '), 'warn');
							draw();
						});
					},
					function (err) {
						if (!m.alive) return;
						ui.clear(listBox);
						listBox.appendChild(ui.errorBox(new Error('The to-do list could not be read: ' + err.message), loadList));
					}
				);
			}

			function scheduleSave() {
				api.dirty(true);
				clearTimeout(m.saveTimer);
				m.saveTimer = setTimeout(save, 700);
			}

			function save() {
				clearTimeout(m.saveTimer);
				m.saveTimer = null;
				if (m.saving) {
					// One save at a time; the next one picks up whatever changed meanwhile.
					return m.saving.then(save);
				}
				var text = T.serialize(m.items);
				if (text === m.lastText) {
					api.dirty(false);
					return Promise.resolve();
				}
				say('Saving...');
				var mine = m.items.slice();
				m.saving = api.store
					.save(PATH, text, { message: 'Update the to-do list' })
					.then(
						function (r) {
							m.lastText = text;
							if (r.state === 'saved') {
								m.base = mine;
								api.store.put(VIEW, 'base', mine);
								say('Saved to todos.json in the private repository.');
							} else say('Kept on this device; it goes to GitHub when the connection is back.', 'warn');
						},
						function (err) {
							if (err instanceof api.gh.errors.Conflict) return mergeWithGitHub(mine);
							say('Not saved to GitHub: ' + err.message + ' The list is kept on this device.', 'bad');
						}
					)
					.then(function () {
						m.saving = null;
						if (!m.saveTimer && T.serialize(m.items) === m.lastText) api.dirty(false);
					});
				return m.saving;
			}

			// todos.json changed on GitHub (another device): merge both and save the result.
			function mergeWithGitHub(mine) {
				say('The list changed on another device; putting both together...', 'warn');
				return api.gh.read('private', PATH).then(function (remote) {
					var theirs = remote ? T.parse(remote.text).items : [];
					var merged = T.merge(m.base, mine, theirs);
					// Edits made on this screen while the merge ran are kept on top of it.
					if (m.items !== mine && m.items.length) merged = T.merge(mine, m.items, merged);
					var text = T.serialize(merged);
					return api.store.save(PATH, text, { message: 'Update the to-do list (merged with another device)', sha: remote ? remote.sha : null }).then(function (r) {
						m.items = merged;
						m.base = merged;
						m.lastText = text;
						api.store.put(VIEW, 'base', merged);
						draw();
						say(r.state === 'saved' ? 'Merged with the changes from another device and saved.' : 'Merged; kept on this device until the connection is back.', r.state === 'saved' ? '' : 'warn');
					});
				}).catch(function (err) {
					say('The list changed on another device and could not be merged: ' + err.message + ' Your version is kept on this device; Home lets you choose which one wins.', 'bad');
				});
			}

			// The queue holds a version in conflict (from an earlier session): merge it now.
			function settleConflict(r) {
				var mine = T.parse(r.text).items;
				return api.store.get(VIEW, 'base', []).then(function (b) {
					m.base = Array.isArray(b) ? b : [];
					m.items = mine;
					m.loaded = true;
					draw();
					return mergeWithGitHub(mine);
				});
			}

			function change(items, message) {
				m.items = items;
				draw();
				scheduleSave();
				if (message) say(message);
			}

			// ---- drawing -----------------------------------------------------------
			function drawFilter() {
				var counts = T.tagCounts(m.items);
				var want = m.filter.tag;
				ui.clear(tagSel);
				tagSel.appendChild(h('option', { value: '', text: 'All tags' }));
				var found = false;
				counts.forEach(function (c) {
					if (c.tag === want) found = true;
					tagSel.appendChild(h('option', { value: c.tag, text: '#' + c.tag + ' (' + c.open + ' open)' }));
				});
				if (want && !found) tagSel.appendChild(h('option', { value: want, text: '#' + want + ' (none)' }));
				tagSel.value = want;
			}

			function visible() {
				return T.filter(m.items, { tag: m.filter.tag, done: m.filter.showDone ? undefined : false });
			}

			function draw(focusId, focusWhat) {
				if (!m.alive) return;
				drawFilter();
				var shown = visible();
				var open = m.items.filter(function (i) {
					return !i.done;
				}).length;
				count.textContent = open + ' open' + (m.items.length - open ? ', ' + (m.items.length - open) + ' done' : '');
				ui.clear(listBox);
				if (!m.items.length) {
					listBox.appendChild(h('p', { class: 'th-empty', id: 'todo-empty', text: 'Nothing on the list. Add a to-do above, or import a list (a JSON file) with Import.' }));
					return;
				}
				if (!shown.length) {
					listBox.appendChild(h('p', { class: 'th-empty', id: 'todo-empty', text: m.filter.tag ? 'Nothing open with #' + m.filter.tag + '.' : 'Everything is done.' }));
					return;
				}
				var ids = shown.map(function (i) {
					return i.id;
				});
				var ul = h('ul', { class: 'th-items', id: 'todo-items' });
				var today = ui.date.iso();
				shown.forEach(function (item, n) {
					ul.appendChild(itemNode(item, n, ids, today));
				});
				listBox.appendChild(ul);
				if (focusId) {
					var target = ul.querySelector('[data-id="' + cssId(focusId) + '"] ' + (focusWhat || '.th-text'));
					if (!target || target.disabled) target = ul.querySelector('[data-id="' + cssId(focusId) + '"] .th-text');
					if (target) target.focus();
				}
			}

			function cssId(id) {
				return String(id).replace(/[^A-Za-z0-9_\-]/g, '');
			}

			function itemNode(item, n, ids, today) {
				var box = h('input', { type: 'checkbox', checked: !!item.done, 'aria-label': 'Done: ' + item.text, on: { change: function () {
					toggle(item.id, box.checked);
				} } });
				var meta = h('div', { class: 'th-meta' });
				if (item.due) {
					var st = T.dueState(item.due, today);
					var kind = item.done ? '' : st === 'overdue' ? 'bad' : st === 'today' || st === 'soon' ? 'warn' : '';
					meta.appendChild(h('span', { class: 'badge' + (kind ? ' badge-' + kind : ''), text: (st === 'overdue' && !item.done ? 'overdue: ' : 'due ') + ui.date.short(item.due) }));
				}
				(item.tags || []).forEach(function (t) {
					meta.appendChild(h('span', { class: 'badge' + (t === T.DECISIONS ? ' badge-accent' : ''), text: '#' + t }));
				});
				if (item.link) {
					var safe = T.safeLink(item.link);
					if (safe && safe.external) meta.appendChild(h('a', { class: 'th-out', href: safe.href, target: '_blank', rel: 'noopener noreferrer' }, [ui.icon('external', 14), h('span', { text: shortLink(safe.href) })]));
					else if (safe) meta.appendChild(h('a', { class: 'th-out', href: safe.href }, [ui.icon('back', 14), h('span', { text: 'open in the Desk' })]));
					else meta.appendChild(h('span', { class: 'mono', text: item.link }));
				}
				var up = ui.button('', { kind: 'quiet', icon: 'back', iconSize: 18, label: 'Move up: ' + item.text, class: 'th-up', disabled: n === 0, onClick: function () {
					move(item.id, -1, ids, '.th-up');
				} });
				up.firstChild.classList.add('th-flip-up');
				var down = ui.button('', { kind: 'quiet', icon: 'back', iconSize: 18, label: 'Move down: ' + item.text, class: 'th-down', disabled: n === ids.length - 1, onClick: function () {
					move(item.id, 1, ids, '.th-down');
				} });
				down.firstChild.classList.add('th-flip-down');
				var li = h('li', { class: 'th-item' + (item.done ? ' is-done' : ''), data: { id: cssId(item.id) } }, [
					h('label', { class: 'th-done' }, box),
					h('div', { class: 'th-body' }, [h('button', { type: 'button', class: 'th-text', title: 'Edit (Alt+Up and Alt+Down move it)', text: item.text, on: { click: function () {
						edit(item.id);
					} } }), meta]),
					h('div', { class: 'th-move' }, [up, down]),
				]);
				li.addEventListener('keydown', function (e) {
					if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
					e.preventDefault();
					move(item.id, e.key === 'ArrowUp' ? -1 : 1, ids, '.th-text');
				});
				return li;
			}

			function shortLink(href) {
				var s = href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '');
				return s.length > 48 ? s.slice(0, 45) + '...' : s;
			}

			// ---- changes ---------------------------------------------------------
			function onAdd(e) {
				e.preventDefault();
				if (m.loaded !== true) {
					say('The list has not been read yet, so nothing can be added. Try again once it is shown.', 'bad');
					return;
				}
				var q = T.parseQuick(quick.value);
				if (!q.text) {
					say('Type something first.', 'warn');
					quick.focus();
					return;
				}
				var now = new Date();
				var item = T.normalizeItem({ text: q.text, tags: q.tags, due: q.due, link: q.link, created: now }, now);
				item.id = T.makeId(now.getTime());
				// A new to-do goes on top of the list; with a tag filter on, it gets that tag.
				if (m.filter.tag && item.tags.indexOf(m.filter.tag) === -1) item.tags.push(m.filter.tag);
				quick.value = '';
				change([item].concat(m.items), 'Added "' + item.text + '".');
				quick.focus();
			}

			function find(id) {
				for (var i = 0; i < m.items.length; i++) if (m.items[i].id === id) return i;
				return -1;
			}

			function replaceItem(id, fields) {
				var i = find(id);
				if (i === -1) return null;
				var next = m.items.slice();
				var it = {};
				Object.keys(next[i]).forEach(function (k) {
					it[k] = next[i][k];
				});
				Object.keys(fields).forEach(function (k) {
					it[k] = fields[k];
				});
				it.updated = ui.date.utc();
				next[i] = it;
				return next;
			}

			function toggle(id, done) {
				var next = replaceItem(id, { done: done, doneAt: done ? ui.date.utc() : '' });
				if (!next) return;
				m.items = next;
				draw(id, 'input[type="checkbox"]');
				scheduleSave();
				var it = m.items[find(id)];
				say((done ? 'Done: ' : 'Open again: ') + it.text + (done && !m.filter.showDone ? ' (hidden; tick "Show done" to see it)' : ''));
				if (done && !m.filter.showDone) quick.focus();
			}

			function move(id, delta, ids, focusWhat) {
				var next = T.move(m.items, id, delta, ids);
				if (next === m.items) return;
				m.items = next;
				draw(id, focusWhat);
				scheduleSave();
				var shown = visible();
				for (var i = 0; i < shown.length; i++) if (shown[i].id === id) say('Moved to place ' + (i + 1) + ' of ' + shown.length + '.');
			}

			function edit(id) {
				var i = find(id);
				if (i === -1) return;
				var it = m.items[i];
				ui.dialog(function (dlg, close) {
					var text = h('textarea', { class: 'input', id: 'todo-edit-text', rows: '3', maxlength: '2000', 'data-autofocus': '', value: it.text });
					var due = h('input', { class: 'input', id: 'todo-edit-due', type: 'date', value: it.due || '' });
					var tags = h('input', { class: 'input', id: 'todo-edit-tags', type: 'text', autocomplete: 'off', value: (it.tags || []).join(', ') });
					var link = h('input', { class: 'input', id: 'todo-edit-link', type: 'url', autocomplete: 'off', value: it.link || '' });
					var done = h('input', { type: 'checkbox', id: 'todo-edit-done', checked: !!it.done });
					var err = h('p', { class: 'field-error', role: 'alert' });
					var form = h('form', { on: { submit: function (e) {
						e.preventDefault();
						var body = text.value.replace(/\s+/g, ' ').trim();
						if (!body) {
							err.textContent = 'A to-do needs some text.';
							text.focus();
							return;
						}
						var l = link.value.trim();
						if (l && !T.safeLink(l)) {
							err.textContent = 'The link should start with https://, http:// or mailto:, or be a page of the Desk such as #/write.';
							link.focus();
							return;
						}
						close({ text: body.slice(0, 2000), due: T.isoDay(due.value), tags: T.cleanTags(tags.value), link: l, done: done.checked });
					} } }, [
						h('h2', { id: 'dlg-title', text: 'Edit the to-do' }),
						h('div', { class: 'dialog-body' }, [
							ui.field('What', text),
							ui.field('Due', due, 'Leave empty for no date.'),
							ui.field('Tags', tags, 'Separated by commas or spaces. "decisions" marks what only you can decide.'),
							ui.field('Link', link),
							h('label', { class: 'check', for: 'todo-edit-done' }, [done, h('span', { text: 'Done' })]),
							err,
						]),
						h('div', { class: 'dialog-actions' }, [
							ui.button('Delete', { kind: 'danger', icon: 'trash', id: 'todo-edit-delete', onClick: function () {
								close('delete');
							} }),
							h('span', { class: 'th-spacer', style: { flex: '1' } }),
							ui.button('Cancel', { id: 'todo-edit-cancel', onClick: function () {
								close(undefined);
							} }),
							ui.button('Save', { kind: 'primary', type: 'submit', id: 'todo-edit-save' }),
						]),
					]);
					dlg.appendChild(form);
				}).then(function (result) {
					if (!m.alive || result === undefined) {
						draw(id);
						return;
					}
					if (result === 'delete') {
						var removed = m.items[find(id)];
						change(
							m.items.filter(function (x) {
								return x.id !== id;
							}),
							'Deleted "' + (removed ? removed.text : '') + '".'
						);
						quick.focus();
						return;
					}
					var cur = m.items[find(id)];
					if (!cur) return;
					var next = replaceItem(id, { text: result.text, due: result.due, tags: result.tags, link: result.link, done: result.done, doneAt: result.done ? cur.doneAt || ui.date.utc() : '' });
					m.items = next;
					draw(id);
					scheduleSave();
					say('Changed "' + result.text + '".');
				});
			}

			function onFilter() {
				m.filter.tag = tagSel.value;
				m.filter.showDone = doneBox.checked;
				try {
					api.settings.set('todos.tag', m.filter.tag || undefined);
					api.settings.set('todos.showDone', m.filter.showDone || undefined);
				} catch (e) {
					/* not kept: fine */
				}
				draw();
			}

			// ---- import and export ------------------------------------------------
			function onExport() {
				var text = T.serialize(m.items);
				var blob = new Blob([text], { type: 'application/json' });
				var url = URL.createObjectURL(blob);
				m.urls.push(url);
				var a = h('a', { href: url, download: 'todos-' + ui.date.iso() + '.json', hidden: true });
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				say('Exported ' + m.items.length + ' to-dos as todos-' + ui.date.iso() + '.json.');
			}

			function onImportFile() {
				var file = fileInput.files && fileInput.files[0];
				if (!file) return;
				if (file.size > 2 * 1024 * 1024) {
					say('That file is larger than 2 MB; a to-do list is much smaller. Nothing was imported.', 'bad');
					return;
				}
				var reader = new FileReader();
				reader.onerror = function () {
					say('The file could not be read. Nothing was imported.', 'bad');
				};
				reader.onload = function () {
					var parsed = T.parse(String(reader.result || ''));
					if (parsed.invalid) {
						say(file.name + ': ' + parsed.problems[0] + ' Nothing was imported.', 'bad');
						return;
					}
					if (!parsed.items.length) {
						say(file.name + ' holds no to-dos. Nothing was imported.', 'warn');
						return;
					}
					askImport(file.name, parsed);
				};
				reader.readAsText(file);
			}

			function askImport(name, parsed) {
				var broken = m.loaded === 'broken';
				ui.dialog(function (dlg, close) {
					var body = [h('p', { text: name + ' holds ' + parsed.items.length + ' to-do' + (parsed.items.length === 1 ? '' : 's') + '.' })];
					if (parsed.problems.length) body.push(h('p', { class: 'muted small', text: parsed.problems.join(' ') }));
					if (broken) body.push(h('p', { text: 'The list on GitHub could not be read, so the file can only replace it.' }));
					else body.push(h('p', { text: 'Add the new ones to your ' + m.items.length + ' (the ones already on your list, by id or by the same text, are skipped), or replace your list with the file.' }));
					dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Import to-dos' }));
					dlg.appendChild(h('div', { class: 'dialog-body' }, body));
					var cancel = ui.button('Cancel', { id: 'todo-import-cancel', onClick: function () {
						close(undefined);
					} });
					cancel.setAttribute('data-autofocus', '');
					dlg.appendChild(
						h('div', { class: 'dialog-actions' }, [
							cancel,
							ui.button('Replace my list', { kind: broken ? 'primary' : 'danger', id: 'todo-import-replace', onClick: function () {
								close('replace');
							} }),
							broken ? null : ui.button('Add the new ones', { kind: 'primary', id: 'todo-import-merge', onClick: function () {
								close('merge');
							} }),
						])
					);
				}).then(function (mode) {
					if (!mode || !m.alive) return;
					var r = T.importItems(m.items, parsed.items, mode);
					if (broken) {
						m.loaded = true;
						m.lastText = null;
					}
					change(r.items, mode === 'replace' ? 'The list now holds the ' + r.items.length + ' to-dos from ' + name + '.' : 'Added ' + r.added + ' to-do' + (r.added === 1 ? '' : 's') + (r.skipped ? '; ' + r.skipped + ' were already on the list' : '') + '.');
				});
			}

			// ---- drafts --------------------------------------------------------------
			function loadDrafts() {
				ui.clear(draftsBox);
				draftsBox.appendChild(h('p', { class: 'th-empty', text: 'Looking at drafts/...' }));
				return api.store
					.list('drafts')
					.then(function (files) {
						var list = files.filter(function (f) {
							return f.type === 'file' && f.name.charAt(0) !== '.' && /\.(md|markdown|txt)$/i.test(f.name);
						});
						var offline = !!files.cached;
						return api.store.get(VIEW, 'draftDates', {}).then(function (known) {
							known = known && typeof known === 'object' ? known : {};
							var out = [];
							var jobs = list.slice(0, 60).map(function (f) {
								return function () {
									var d = { path: f.path, name: f.name, title: '', at: '', pending: !!f.pending, words: 0 };
									out.push(d);
									var titleJob = api.store.read(f.path, { prefer: 'cache' }).then(
										function (r) {
											if (r) {
												d.title = C.drafts.title(r.text, f.name);
												d.words = C.drafts.wordCount(r.text);
											}
										},
										function () {
											d.title = C.drafts.title('', f.name);
										}
									);
									var dateJob;
									if (f.pending) dateJob = Promise.resolve((d.at = ''));
									else if (known[f.path] && known[f.path].sha === f.sha) dateJob = Promise.resolve((d.at = known[f.path].at));
									else if (offline) dateJob = Promise.resolve();
									else {
										dateJob = api.gh.get(api.gh.repoPath('private', '/commits'), { path: f.path, per_page: 1 }).then(
											function (commits) {
												var c = Array.isArray(commits) && commits[0] && commits[0].commit;
												var at = c && ((c.committer && c.committer.date) || (c.author && c.author.date));
												if (at) {
													d.at = String(at);
													known[f.path] = { sha: f.sha, at: d.at };
												}
											},
											function () {
												/* no date: listed last */
											}
										);
									}
									return Promise.all([titleJob, dateJob]);
								};
							});
							return pool(jobs, 4).then(function () {
								var keep = {};
								list.forEach(function (f) {
									if (known[f.path]) keep[f.path] = known[f.path];
								});
								api.store.put(VIEW, 'draftDates', keep);
								drawDrafts(out, offline, list.length);
							});
						});
					})
					.catch(function (err) {
						if (!m.alive) return;
						ui.clear(draftsBox);
						draftsBox.appendChild(ui.errorBox(new Error('The drafts could not be listed: ' + err.message), loadDrafts));
					});
			}

			function drawDrafts(drafts, offline, total) {
				if (!m.alive) return;
				ui.clear(draftsBox);
				var s = C.drafts.summary(drafts);
				if (!s.count) {
					draftsBox.appendChild(h('p', { class: 'th-empty', id: 'todo-drafts-none', text: 'No drafts in drafts/ in the private repository.' }));
					return;
				}
				var line = s.count + ' draft' + (s.count === 1 ? '' : 's') + '.';
				if (s.oldest) line += ' Untouched longest: "' + (s.oldest.title || s.oldest.name) + '", last changed ' + ui.date.ago(s.oldest.at) + '.';
				draftsBox.appendChild(h('p', { class: 'th-sub', id: 'todo-drafts-line', text: line }));
				if (offline) draftsBox.appendChild(h('p', { class: 'muted small', text: 'GitHub could not be reached; this is the list kept on this device.' }));
				if (total > drafts.length) draftsBox.appendChild(h('p', { class: 'muted small', text: 'Showing ' + drafts.length + ' of ' + total + '.' }));
				var ul = h('ul', { class: 'th-drafts', id: 'todo-drafts-list' });
				s.sorted.forEach(function (d) {
					var meta = d.pending ? 'not on GitHub yet' : d.at ? 'last changed ' + ui.date.ago(d.at) : 'date unknown';
					if (d.words) meta += ' · ' + d.words + ' words';
					ul.appendChild(
						h('li', {}, ui.row({ title: d.title || d.name, meta: meta + ' · ' + d.name, badge: s.oldest && d === s.oldest ? 'oldest' : '', badgeKind: 'warn', onClick: function () {
							api.nav('write', { draft: d.path });
						} }))
					);
				});
				draftsBox.appendChild(ul);
			}

			// ---- the stories board -----------------------------------------------------
			var SOURCES = { publications: 'assets/data/publications.json', posts: 'blog/index.json', stories: 'misc/55-paper-theatre/stories/index.json' };

			function fetchJSON(path) {
				return fetch(api.siteRoot + path, { cache: 'no-cache', credentials: 'same-origin' }).then(
					function (r) {
						if (!r.ok) {
							if (r.body && r.body.cancel) r.body.cancel();
							throw new Error(path + ' answered ' + r.status + (r.status === 404 ? ' (not found)' : '') + '.');
						}
						return r.text().then(function (t) {
							try {
								return JSON.parse(t);
							} catch (e) {
								throw new Error(path + ' is not valid JSON.');
							}
						});
					},
					function () {
						var e = new Error('The site could not be reached for ' + path + ' (no connection?).');
						e.offline = true;
						throw e;
					}
				);
			}

			function loadBoard(fresh) {
				var cached = api.store.get(VIEW, 'board', null);
				return cached.then(function (c) {
					if (!m.alive) return;
					if (c && c.data && !fresh) drawBoard(c.data, c.at, false);
					var keys = Object.keys(SOURCES);
					return Promise.all(
						keys.map(function (k) {
							return fetchJSON(SOURCES[k]);
						})
					).then(
						function (vals) {
							var data = {};
							keys.forEach(function (k, i) {
								data[k] = vals[i];
							});
							var at = new Date().toISOString();
							api.store.put(VIEW, 'board', { at: at, data: data });
							drawBoard(data, at, false);
						},
						function (err) {
							if (!m.alive) return;
							if (c && c.data) {
								drawBoard(c.data, c.at, true);
								boardBox.insertBefore(ui.notice('Showing the copy from ' + ui.date.ago(c.at) + ': ' + err.message, 'warn'), boardBox.firstChild);
							} else {
								ui.clear(boardBox);
								boardBox.appendChild(ui.errorBox(err, function () {
									loadBoard(true);
								}));
							}
						}
					);
				});
			}

			var STATUS_KIND = { published: 'ok', draft: 'warn', embargo: 'accent' };

			function storyCell(story) {
				var cell = h('div', { class: 'th-story' });
				if (!story) {
					cell.appendChild(h('span', { class: 'badge', text: 'no story yet' }));
					return cell;
				}
				cell.appendChild(h('span', { class: 'badge badge-' + (STATUS_KIND[story.status] || 'bad'), text: story.status }));
				if (story.verify) cell.appendChild(h('span', { class: 'badge badge-warn', title: 'The story still carries the verify flag in the stories index.', text: 'verify' }));
				if (story.href) cell.appendChild(h('a', { class: 'th-out', href: api.siteUrl + story.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open the story "' + story.title + '" on the live site' }, [ui.icon('external', 14), h('span', { text: 'story' })]));
				return cell;
			}

			function drawBoard(data, at, stale) {
				if (!m.alive) return;
				ui.clear(boardBox);
				var b = C.stories.board(data.publications, data.posts, data.stories);
				var counts = h('div', { class: 'th-counts', id: 'todo-board-counts' }, [
					h('span', { class: 'badge', text: b.counts.rows + ' rows' }),
					h('span', { class: 'badge badge-ok', text: b.counts.published + ' with a published story' }),
					h('span', { class: 'badge', text: b.counts.none + ' without a story' }),
					h('span', { class: 'badge badge-warn', text: b.counts.verify + ' flagged verify' }),
				]);
				boardBox.appendChild(counts);
				function group(title, rows, lineOf, id) {
					boardBox.appendChild(h('h3', { class: 'th-group', text: title + ' (' + rows.length + ')' }));
					if (!rows.length) {
						boardBox.appendChild(h('p', { class: 'th-empty', text: 'None.' }));
						return;
					}
					var ul = h('ul', { class: 'th-board', id: id });
					rows.forEach(function (row) {
						ul.appendChild(h('li', {}, [h('div', {}, lineOf(row)), storyCell(row.story)]));
					});
					boardBox.appendChild(ul);
				}
				group('Publications', b.papers, function (row) {
					return [h('span', { class: 'th-title', text: row.title }), row.venue ? h('span', { class: 'th-venue', text: row.venue }) : null];
				}, 'todo-board-papers');
				group('Posts', b.posts, function (row) {
					return [h('a', { class: 'th-title', href: api.siteUrl + '#/post/' + encodeURIComponent(row.slug), target: '_blank', rel: 'noopener noreferrer', text: row.title }), row.date ? h('span', { class: 'th-venue', text: ui.date.long(row.date) }) : null];
				}, 'todo-board-posts');
				if (b.orphans.length) {
					group('Stories that belong to no row', b.orphans, function (s) {
						return [h('span', { class: 'th-title', text: s.title || s.id }), h('span', { class: 'th-venue', text: s.kind + ' story "' + s.id + '"' })];
					}, 'todo-board-orphans');
					// orphans carry the story itself
					Array.prototype.forEach.call(boardBox.querySelectorAll('#todo-board-orphans li'), function (li, i) {
						li.replaceChild(storyCell(b.orphans[i]), li.lastChild);
					});
				}
				boardBox.appendChild(h('p', { class: 'muted small', text: 'From the live site\'s ' + SOURCES.publications + ', ' + SOURCES.posts + ' and ' + SOURCES.stories + (at ? ', read ' + ui.date.ago(at) : '') + (stale ? ' (not current)' : '') + '.' }));
			}

			// ---- start -------------------------------------------------------------------
			api.on('lock', function () {
				if (m.saveTimer) return save();
			});
			api.on('sync', function () {
				// The queue was flushed: a queued list may now be on GitHub.
				if (m.alive && m.loaded === true && !m.saveTimer && !m.saving && /device/.test(status.textContent)) {
					api.store.read(PATH, { prefer: 'cache' }).then(function (r) {
						if (r && !r.pending && m.alive) say('Saved to todos.json in the private repository.');
					}, function () {});
				}
			});

			return Promise.all([loadList(), loadDrafts(), loadBoard(false)]).then(function () {
				m.flush = save;
			});
		});
	}

	// Runs the job functions, at most n at a time. -> Promise (never rejects)
	function pool(jobs, n) {
		return new Promise(function (resolve) {
			var next = 0;
			var running = 0;
			if (!jobs.length) return resolve();
			function start() {
				while (running < n && next < jobs.length) {
					var job = jobs[next++];
					running++;
					Promise.resolve()
						.then(job)
						.catch(function () {})
						.then(function () {
							running--;
							if (next >= jobs.length && running === 0) resolve();
							else start();
						});
				}
			}
			start();
		});
	}

	function unmount() {
		var m = M;
		M = null;
		if (!m) return;
		m.alive = false;
		// Unsaved edits still go out (or into the queue) after leaving the view.
		if (m.saveTimer) {
			clearTimeout(m.saveTimer);
			if (m.flush) m.flush();
		}
		setTimeout(function () {
			m.urls.forEach(function (u) {
				URL.revokeObjectURL(u);
			});
		}, 1000);
	}

	if (window.Desk && window.Desk.registerView) {
		window.Desk.registerView({
			id: VIEW,
			title: 'To-dos',
			icon: 'todos',
			order: 40,
			description: 'Your list, drafts at a glance, and which papers and posts have a story.',
			mount: mount,
			unmount: unmount,
		});
	}
})();
