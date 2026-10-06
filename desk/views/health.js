// The Desk's Health view (#/health).
//
//   - Deploys: the latest commits on main, the latest GitHub Pages builds, the
//     recent runs of each Actions workflow, and "not yet live": commits newer
//     than the last successful Pages build. Each part says plainly which token
//     permission is missing when GitHub refuses it.
//   - Live checks, run from this browser against the site itself (same origin,
//     api.siteRoot + path), four requests at a time, with a progress bar and a
//     Stop button: toys and thumbnails, posts and the post index, stories,
//     internal links inside posts, sitemap and robots, publications.json against
//     the Publications section of index.html.
//   - The last results are kept on the device with their time; "Run again"
//     refreshes. The summary ("All green", "2 of 7 checks failing") is kept in
//     api.store('health', 'summary') and announced as the event
//     'health:summary' { state, text, at }; the Home tile's description shows it.
//
// The pure parts are in desk/checks.js (tested by desk/test/test-checks.mjs).
// Every string from GitHub or from a file goes into the page as text; only
// links to github.com and to this site are made links.

(function () {
	'use strict';

	var VIEW = 'health';
	var CONCURRENCY = 4;
	var DEFAULT_DESCRIPTION = 'Deploys, Actions runs and live checks of the site.';

	var HERE = (function () {
		var s = document.currentScript;
		return s && s.src ? s.src.replace(/views\/[^\/]*$/, '') : new URL('./', location.href).href;
	})();

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

	// The last summary this page has seen, for the Home tile (see `description`).
	var lastSummary = null;
	var M = null;

	var CHECKS = [
		{ id: 'toys', title: 'Every toy and its thumbnail answer' },
		{ id: 'posts', title: 'Every post in blog/index.json has its file' },
		{ id: 'index', title: 'Every file in blog/posts is in blog/index.json' },
		{ id: 'stories', title: 'Every Paper Theatre story has its file' },
		{ id: 'links', title: 'Links inside posts point at things that exist' },
		{ id: 'meta', title: 'sitemap.xml and robots.txt are there' },
		{ id: 'pubs', title: 'publications.json matches the Publications section' },
	];

	function mount(el, api) {
		var ui = api.ui;
		var h = ui.el;
		var m = (M = { api: api, alive: true, run: null, abort: null });

		var loading = h('p', { class: 'muted', text: 'Loading...' });
		el.appendChild(loading);

		return loadDeps().then(function () {
			if (!m.alive) return;
			el.removeChild(loading);
			var C = window.DeskChecks;
			var E = api.gh.errors;

			// ---- the checks card ---------------------------------------------------
			var summary = h('p', { class: 'th-summary', id: 'health-summary', 'aria-live': 'polite' });
			var runBtn = ui.button('Run the checks', { kind: 'primary', icon: 'refresh', id: 'health-run', onClick: function () {
				runChecks();
			} });
			var stopBtn = ui.button('Stop', { id: 'health-stop', hidden: true, onClick: stop });
			stopBtn.hidden = true;
			var barFill = h('span');
			var bar = h('div', { class: 'th-bar', role: 'progressbar', 'aria-label': 'Checks done', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, barFill);
			var progressText = h('p', { id: 'health-progress-text' });
			var progress = h('div', { class: 'th-progress', id: 'health-progress', hidden: true }, [bar, progressText]);
			var checksList = h('ul', { class: 'th-checks', id: 'health-checks' });
			var checksCard = h('section', { class: 'card', 'aria-labelledby': 'health-h-checks' }, [
				h('div', { class: 'card-head' }, [h('h2', { id: 'health-h-checks', text: 'Live checks' }), h('div', { class: 'actions' }, [stopBtn, runBtn])]),
				h('p', { class: 'th-sub', text: 'Asked from this browser of the site itself (' + api.siteRoot.replace(/\/$/, '') + '), a few requests at a time.' }),
				summary,
				progress,
				checksList,
			]);

			// ---- the deploys card -----------------------------------------------------
			var pendingBox = h('section', { id: 'health-pending' });
			var commitsBox = h('section', { id: 'health-commits' });
			var pagesBox = h('section', { id: 'health-pages' });
			var runsBox = h('section', { id: 'health-runs' });
			var deployNote = h('p', { class: 'muted small', id: 'health-deploys-note' });
			var deployBtn = ui.button('', { kind: 'quiet', icon: 'refresh', label: 'Ask GitHub again', class: 'btn-small', id: 'health-deploys-refresh', onClick: function () {
				ui.busy(deployBtn, loadDeploys());
			} });
			var deploysCard = h('section', { class: 'card', 'aria-labelledby': 'health-h-deploys' }, [
				h('div', { class: 'card-head' }, [h('h2', { id: 'health-h-deploys', text: 'Deploys' }), deployBtn]),
				h('div', { class: 'th-deploy-grid' }, [pendingBox, pagesBox, commitsBox, runsBox]),
				deployNote,
			]);

			el.appendChild(checksCard);
			el.appendChild(deploysCard);

			// ---- small helpers ----------------------------------------------------------
			function liveUrl(path) {
				return api.siteRoot + String(path || '').replace(/^\/+/, '');
			}

			function outLink(href, text, label) {
				return h('a', { class: 'th-out', href: href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label }, [h('span', { text: text }), ui.icon('external', 14)]);
			}

			// A refusal in plain words, with what to do about a missing permission.
			function explain(err, what) {
				var msg = what + ': ' + (err && err.message ? err.message : String(err));
				if (err instanceof E.Forbidden && err.permission) msg += ' Give the token "' + err.permission + '" (read-only is enough) at github.com/settings/personal-access-tokens: edit the token, its value stays the same.';
				else if (err instanceof E.RateLimited && err.resetAt) msg += ' GitHub answers again at ' + ui.date.time(err.resetAt) + '.';
				return new Error(msg);
			}

			// ---- the checks ---------------------------------------------------------------
			function stateIcon(state) {
				return state === 'ok' ? 'check' : state === 'fail' ? 'warning' : state === 'run' ? 'syncing' : state === 'wait' ? 'dot' : 'info';
			}

			function drawSummary(saved, running) {
				ui.clear(summary);
				if (running) {
					summary.setAttribute('data-state', 'run');
					summary.appendChild(ui.icon('syncing', 20));
					summary.appendChild(h('span', { text: 'Checking...' }));
					return;
				}
				if (!saved) {
					summary.setAttribute('data-state', 'skip');
					summary.appendChild(ui.icon('info', 20));
					summary.appendChild(h('span', { text: 'The checks have not run on this device yet.' }));
					return;
				}
				summary.setAttribute('data-state', saved.roll.state);
				summary.appendChild(ui.icon(stateIcon(saved.roll.state), 20));
				summary.appendChild(h('span', { text: saved.text }));
				summary.appendChild(h('small', { text: (saved.stopped ? 'stopped ' : 'checked ') + ui.date.ago(saved.at) + ' (' + ui.date.long(saved.at) + ', ' + ui.date.time(saved.at) + ')' }));
			}

			function drawChecks(results) {
				ui.clear(checksList);
				CHECKS.forEach(function (def) {
					var r = results && results[def.id];
					var state = r ? r.state : 'wait';
					var detail = r ? r.note || (r.checked ? r.checked + ' checked' : '') : 'not run yet';
					var li = h('li', { class: 'th-check', data: { state: state, check: def.id } }, [
						h('div', { class: 'th-check-head' }, [ui.icon(stateIcon(state), 20), h('div', { class: 'th-check-title' }, [h('span', { text: def.title }), detail ? h('small', { text: detail }) : null]), h('span', { class: 'sr-only', text: state === 'ok' ? 'passed' : state === 'fail' ? 'failed' : state === 'warn' ? 'warning' : state === 'skip' ? 'skipped' : state === 'run' ? 'running' : 'waiting' })]),
					]);
					if (r && r.problems && r.problems.length) {
						var ul = h('ul', { class: 'th-problems' });
						r.problems.slice(0, 50).forEach(function (p) {
							var line = [h('span', { text: p.what })];
							if (p.where || p.href) {
								var where = h('span', { class: 'th-where' });
								if (p.where) where.appendChild(h('span', { text: 'in ' + p.where + ' ' }));
								if (p.href) where.appendChild(outLink(p.href, 'open', 'Open ' + (p.label || p.href)));
								line.push(where);
							}
							ul.appendChild(h('li', {}, line));
						});
						if (r.problems.length > 50) ul.appendChild(h('li', { class: 'muted', text: 'and ' + (r.problems.length - 50) + ' more' }));
						li.appendChild(ul);
					}
					checksList.appendChild(li);
				});
			}

			function setProgress(done, total) {
				var pct = total ? Math.round((done / total) * 100) : 0;
				barFill.style.width = pct + '%';
				bar.setAttribute('aria-valuenow', String(pct));
				progressText.textContent = done + ' of ' + total + ' requests';
			}

			function stop() {
				if (m.abort) m.abort.abort();
			}

			// One request to the site. -> Promise<status> (0 = no answer). Never rejects
			// except when stopped.
			function ask(path, signal, wantText) {
				var url = liveUrl(path);
				function go(method) {
					return fetch(url, { method: method, cache: 'no-store', credentials: 'same-origin', redirect: 'follow', signal: signal }).then(function (r) {
						if (method === 'HEAD' && (r.status === 405 || r.status === 501)) return go('GET');
						if (wantText && r.ok) {
							return r.text().then(function (t) {
								return { status: r.status, text: t };
							});
						}
						if (r.body && r.body.cancel) r.body.cancel().catch(function () {});
						return { status: r.status, text: null };
					});
				}
				return go(wantText ? 'GET' : 'HEAD').catch(function (err) {
					if (signal.aborted) throw err;
					return { status: 0, text: null };
				});
			}

			function statusWords(st) {
				if (st === 0) return 'did not answer';
				if (st === 404) return 'is missing (404)';
				return 'answered ' + st;
			}

			function runChecks() {
				if (m.run) return m.run;
				var ctrl = new AbortController();
				m.abort = ctrl;
				var signal = ctrl.signal;
				var results = {};
				var total = 0;
				var done = 0;
				var queue = [];
				var running = 0;
				var wake = null;
				CHECKS.forEach(function (c) {
					results[c.id] = { id: c.id, state: 'run', checked: 0, problems: [] };
				});
				drawChecks(results);
				drawSummary(null, true);
				progress.hidden = false;
				setProgress(0, 0);
				runBtn.disabled = true;
				stopBtn.hidden = false;
				stopBtn.focus();

				// A queue of requests shared by every check: CONCURRENCY at a time.
				function request(path, wantText) {
					total++;
					setProgress(done, total);
					return new Promise(function (resolve, reject) {
						queue.push({ path: path, wantText: wantText, resolve: resolve, reject: reject });
						pump();
					});
				}
				function pump() {
					while (running < CONCURRENCY && queue.length) {
						var job = queue.shift();
						if (signal.aborted) {
							job.reject(stopped());
							continue;
						}
						running++;
						(function (job) {
							ask(job.path, signal, job.wantText).then(
								function (r) {
									running--;
									done++;
									setProgress(done, total);
									job.resolve(r);
									pump();
								},
								function (e) {
									running--;
									job.reject(e);
									pump();
								}
							);
						})(job);
					}
				}
				function stopped() {
					var e = new Error('stopped');
					e.stopped = true;
					return e;
				}
				signal.addEventListener('abort', function () {
					queue.splice(0).forEach(function (j) {
						j.reject(stopped());
					});
				});

				function finish(id, problems, checked, note) {
					var r = results[id];
					r.problems = problems;
					r.checked = checked;
					r.note = note || '';
					r.state = C.stateOf(problems);
					drawChecks(results);
				}
				function skip(id, why) {
					var r = results[id];
					r.state = 'skip';
					r.note = why;
					r.problems = [];
					drawChecks(results);
				}
				function guard(id, work) {
					return work().catch(function (err) {
						if (err && err.stopped) skip(id, 'stopped before it finished');
						else skip(id, 'could not run: ' + (err && err.message ? err.message : String(err)));
					});
				}

				// The site's own index files, read once.
				var files = {};
				function getJSON(path) {
					if (!files[path]) {
						files[path] = request(path, true).then(function (r) {
							if (r.status !== 200) throw new Error(path + ' ' + statusWords(r.status));
							try {
								return JSON.parse(r.text);
							} catch (e) {
								throw new Error(path + ' is not valid JSON');
							}
						});
					}
					return files[path];
				}

				// 1. Toys and thumbnails.
				var toysJob = guard('toys', function () {
					return getJSON('misc/toys.json').then(function (toys) {
						var t = C.toyTargets(toys);
						var problems = t.problems.map(function (p) {
							return { what: p.what, where: p.where, href: liveUrl(p.where) };
						});
						var n = 0;
						var asks = [];
						t.targets.forEach(function (toy) {
							[['page', toy.page], ['thumbnail', toy.thumb]].forEach(function (pair) {
								if (!pair[1]) return;
								n++;
								asks.push(
									request(pair[1]).then(function (r) {
										if (r.status !== 200) problems.push({ what: 'The ' + pair[0] + ' of "' + toy.title + '" ' + statusWords(r.status) + '.', where: pair[1], href: liveUrl(pair[1]) });
									})
								);
							});
						});
						return Promise.all(asks).then(function () {
							finish('toys', problems, n, t.targets.length + ' toys, ' + n + ' requests');
						});
					});
				});

				// 2. Posts and their files; 5. links inside them.
				var postsData = getJSON('blog/index.json');
				var postsJob = guard('posts', function () {
					return postsData.then(function (index) {
						var t = C.postTargets(index);
						var problems = t.problems.map(function (p) {
							return { what: p.what, where: p.where, href: liveUrl(p.where) };
						});
						var texts = {};
						return Promise.all(
							t.targets.map(function (p) {
								return request(p.path, true).then(function (r) {
									if (r.status === 200) texts[p.slug] = { text: r.text, post: p };
									else problems.push({ what: 'The post "' + p.title + '" ' + statusWords(r.status) + '.', where: p.path, href: liveUrl(p.path) });
								});
							})
						).then(function () {
							finish('posts', problems, t.targets.length, t.targets.length + ' posts');
							return { index: index, targets: t.targets, texts: texts };
						});
					});
				});

				var linksJob = guard('links', function () {
					return postsJob.then(function (got) {
						if (!got) throw new Error('the posts could not be read');
						var slugs = got.targets.map(function (p) {
							return p.slug;
						});
						var problems = [];
						var checked = 0;
						var external = 0;
						var byPath = {};
						Object.keys(got.texts).forEach(function (slug) {
							var entry = got.texts[slug];
							var r = C.postLinks(entry.post.file, entry.text, { slugs: slugs });
							external += r.external;
							r.internal.forEach(function (l) {
								var where = entry.post.path + ', line ' + l.line;
								var postHref = api.siteUrl + '#/post/' + encodeURIComponent(slug);
								checked++;
								if (l.problem) {
									problems.push({ what: 'The link "' + l.url + '": ' + l.problem + '.', where: where, href: postHref, label: 'the post "' + entry.post.title + '"' });
									return;
								}
								if (l.type !== 'file') return;
								var p = C.safeSitePath(l.fetchPath);
								if (!p) return;
								(byPath[p] = byPath[p] || []).push({ url: l.url, where: where, href: postHref, title: entry.post.title });
							});
						});
						return Promise.all(
							Object.keys(byPath).map(function (p) {
								return request(p).then(function (r) {
									if (r.status === 200) return;
									byPath[p].forEach(function (u) {
										problems.push({ what: 'The link "' + u.url + '" ' + statusWords(r.status) + '.', where: u.where, href: u.href, label: 'the post "' + u.title + '"' });
									});
								});
							})
						).then(function () {
							finish('links', problems, checked, checked + ' internal links in ' + Object.keys(got.texts).length + ' posts (' + external + ' links to other sites are not followed)');
						});
					});
				});

				// 3. Every file in blog/posts (from the repository) is in the index.
				var indexJob = guard('index', function () {
					return Promise.all([postsData, api.gh.tree('site', { refresh: true })]).then(
						function (vals) {
							var names = vals[1]
								.filter(function (e) {
									return e.type === 'file' && /^blog\/posts\/[^\/]+$/.test(e.path);
								})
								.map(function (e) {
									return e.path.slice('blog/posts/'.length);
								});
							var cmp = C.comparePostsIndex(vals[0], names);
							var problems = cmp.missingFromIndex.map(function (f) {
								return { what: f + ' is in blog/posts but not in blog/index.json. The Action that builds the index may not have run (see Deploys).', where: 'blog/posts/' + f + ' on ' + api.site.branch, href: 'https://github.com/' + api.site.owner + '/' + api.site.repo + '/blob/' + api.site.branch + '/blog/posts/' + encodeURIComponent(f) };
							});
							cmp.missingFiles.forEach(function (e) {
								problems.push({ what: 'blog/index.json lists ' + e.file + ' (' + e.slug + '), which is not in the repository.', where: 'blog/index.json', href: liveUrl('blog/index.json') });
							});
							if (vals[1].truncated) problems.push({ what: 'GitHub cut the file tree short; some files may not have been compared.', level: 'warn' });
							finish('index', problems, cmp.files, cmp.files + ' files, ' + cmp.indexed + ' in the index');
						},
						function (err) {
							if (err && err.stopped) throw err;
							throw explain(err, 'GitHub refused the file list');
						}
					);
				});

				// 4. Stories.
				var storiesJob = guard('stories', function () {
					return getJSON(C.STORIES_DIR + 'index.json').then(function (list) {
						var t = C.storyTargets(list);
						var problems = t.problems.map(function (p) {
							return { what: p.what, where: p.where, href: liveUrl(p.where) };
						});
						return Promise.all(
							t.targets.map(function (s) {
								return request(s.path).then(function (r) {
									if (r.status !== 200) problems.push({ what: 'The story "' + s.title + '" (' + s.id + ') ' + statusWords(r.status) + '.', where: s.path, href: liveUrl(s.path) });
								});
							})
						).then(function () {
							finish('stories', problems, t.targets.length, t.targets.length + ' stories');
						});
					});
				});

				// 6. sitemap and robots.
				var metaJob = guard('meta', function () {
					var paths = ['sitemap.xml', 'robots.txt'];
					var problems = [];
					return Promise.all(
						paths.map(function (p) {
							return request(p).then(function (r) {
								if (r.status !== 200) problems.push({ what: p + ' ' + statusWords(r.status) + '.', where: p, href: liveUrl(p) });
							});
						})
					).then(function () {
						finish('meta', problems, paths.length);
					});
				});

				// 7. Publications.
				var pubsJob = guard('pubs', function () {
					return Promise.all([getJSON('assets/data/publications.json'), request('index.html', true)]).then(function (vals) {
						if (vals[1].status !== 200) throw new Error('index.html ' + statusWords(vals[1].status));
						var r = C.comparePublications(vals[0], vals[1].text);
						var problems = r.ok ? [] : [{ what: r.what + '.', where: 'assets/data/publications.json and index.html', href: liveUrl('#/publications') }];
						finish('pubs', problems, 1, r.jsonCount + ' in publications.json, ' + r.htmlCount + ' on the page');
					});
				});

				m.run = Promise.all([toysJob, postsJob, linksJob, indexJob, storiesJob, metaJob, pubsJob]).then(function () {
					var list = CHECKS.map(function (c) {
						return results[c.id];
					});
					var roll = C.rollUp(list);
					var saved = { at: new Date().toISOString(), results: results, roll: roll, text: C.summaryText(roll), stopped: signal.aborted };
					m.run = null;
					m.abort = null;
					return api.store.put(VIEW, 'last', saved).then(
						function () {
							return saved;
						},
						function () {
							return saved;
						}
					);
				});
				return m.run.then(function (saved) {
					publishSummary(saved);
					if (!m.alive) return;
					runBtn.disabled = false;
					runBtn.lastChild.textContent = 'Run again';
					stopBtn.hidden = true;
					progress.hidden = true;
					drawSummary(saved, false);
					drawChecks(saved.results);
					runBtn.focus();
					ui.toast(saved.stopped ? 'Stopped. ' + saved.text + '.' : saved.text + '.', { kind: saved.roll.state === 'ok' ? 'ok' : saved.roll.state === 'fail' ? 'bad' : 'warn' });
				});
			}

			function publishSummary(saved) {
				var s = { state: saved.roll.state, text: saved.text, at: saved.at, stopped: !!saved.stopped };
				lastSummary = s;
				api.store.put(VIEW, 'summary', s).catch(function () {});
				api.emit('health:summary', s);
			}

			// ---- deploys ---------------------------------------------------------------------
			function section(box, title, body) {
				ui.clear(box);
				box.appendChild(h('h3', { text: title }));
				(Array.isArray(body) ? body : [body]).forEach(function (n) {
					if (n) box.appendChild(n);
				});
			}

			function runLine(badgeKind, badgeText, main, meta, href) {
				var text = h('span', { class: 'th-run-text' }, [href ? h('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: main }) : h('span', { text: main }), meta ? h('span', { class: 'th-run-meta', text: meta }) : null]);
				return h('li', {}, [h('span', { class: 'badge badge-' + badgeKind, text: badgeText }), text]);
			}

			var KIND = { ok: 'ok', bad: 'bad', warn: 'warn', run: 'accent', muted: 'muted' };

			function settle(p) {
				return p.then(
					function (data) {
						return { ok: true, data: data };
					},
					function (err) {
						return { ok: false, err: err };
					}
				);
			}

			function loadDeploys() {
				var gh = api.gh;
				[pendingBox, pagesBox, commitsBox, runsBox].forEach(function (b) {
					if (!b.firstChild) section(b, '', h('p', { class: 'th-empty', text: 'Asking GitHub...' }));
				});
				return Promise.all([
					settle(gh.get(gh.repoPath('site', '/commits'), { sha: api.site.branch, per_page: 15 })),
					settle(gh.get(gh.repoPath('site', '/pages/builds'), { per_page: 5 })),
					settle(gh.get(gh.repoPath('site', '/actions/runs'), { per_page: 40 })),
				]).then(function (got) {
					var cached = null;
					return api.store
						.get(VIEW, 'deploys', null)
						.then(function (c) {
							cached = c;
						})
						.catch(function () {})
						.then(function () {
							// Keep what came back; fill what did not from the copy on the device.
							var data = { at: new Date().toISOString(), commits: null, builds: null, runs: null };
							var from = {};
							['commits', 'builds', 'runs'].forEach(function (k, i) {
								if (got[i].ok) data[k] = got[i].data;
								else if (cached && cached[k] && waits(got[i].err)) {
									data[k] = cached[k];
									from[k] = cached.at;
								}
							});
							if (got[0].ok || got[1].ok || got[2].ok) {
								api.store.put(VIEW, 'deploys', { at: data.at, commits: data.commits || (cached && cached.commits), builds: data.builds || (cached && cached.builds), runs: data.runs || (cached && cached.runs) }).catch(function () {});
							}
							if (m.alive) drawDeploys(got, data, from);
						});
				});
			}

			function waits(err) {
				return err instanceof E.Offline || err instanceof E.RateLimited;
			}

			function staleNote(at) {
				return at ? h('p', { class: 'muted small', text: 'GitHub could not be reached; this is the copy from ' + ui.date.ago(at) + '.' }) : null;
			}

			function drawDeploys(got, data, from) {
				var retry = function () {
					ui.busy(deployBtn, loadDeploys());
				};
				var commits = data.commits ? C.commitList(data.commits) : null;
				var builds = data.builds ? C.buildList(data.builds) : null;
				var groups = data.runs ? C.groupRuns(data.runs, 4) : null;

				// Not yet live.
				var good = builds ? C.lastGoodBuild(builds) : null;
				var live = good ? { sha: good.commit, date: good.updated || good.created, how: 'the last successful Pages build' } : null;
				if (!live && data.runs) {
					var fromRuns = C.liveFromRuns(data.runs);
					if (fromRuns) live = { sha: fromRuns.sha, date: fromRuns.date, how: 'the last successful "pages build and deployment" run' };
				}
				if (!commits) section(pendingBox, 'Not yet live', ui.errorBox(explain(got[0].err, 'The commits on ' + api.site.branch + ' could not be read'), retry));
				else if (!live) section(pendingBox, 'Not yet live', ui.notice('Unknown: neither the Pages builds nor the Actions runs could be read, so there is nothing to compare the commits with.', 'warn'));
				else {
					var ny = C.notYetLive(commits, live.sha);
					var body = [];
					if (!ny.pending.length) body.push(h('p', { id: 'health-pending-none' }, [h('span', { class: 'badge badge-ok', text: 'all live' }), ' The newest commit on ' + api.site.branch + ' is the one the site was built from.']));
					else {
						body.push(h('p', { id: 'health-pending-count', text: (ny.found ? ny.pending.length : 'At least ' + ny.pending.length) + ' commit' + (ny.pending.length === 1 ? ' is' : 's are') + ' on ' + api.site.branch + ' but not on the site yet. Pages usually catches up within a few minutes.' }));
						var ul = h('ul', { class: 'th-runs' });
						ny.pending.slice(0, 8).forEach(function (c) {
							ul.appendChild(runLine('warn', c.short, c.message, (c.author ? c.author + ', ' : '') + ui.date.ago(c.date), c.url));
						});
						body.push(ul);
					}
					body.push(h('p', { class: 'muted small', text: 'Live: ' + C.shortSha(live.sha) + ', from ' + live.how + (live.date ? ', ' + ui.date.ago(live.date) : '') + '.' }));
					section(pendingBox, 'Not yet live', body);
				}

				// Pages builds.
				if (!builds) section(pagesBox, 'GitHub Pages', ui.errorBox(explain(got[1].err, 'The Pages builds could not be read'), retry));
				else if (!builds.length) section(pagesBox, 'GitHub Pages', h('p', { class: 'th-empty', text: 'GitHub reports no Pages builds yet.' }));
				else {
					var ulb = h('ul', { class: 'th-runs', id: 'health-builds' });
					builds.slice(0, 5).forEach(function (b) {
						var st = C.buildState(b);
						ulb.appendChild(runLine(KIND[st.kind] || 'warn', st.label, 'Commit ' + b.short + (b.error ? ': ' + b.error : ''), ui.date.ago(b.updated || b.created) + (b.durationMs ? ', took ' + Math.round(b.durationMs / 1000) + ' s' : ''), ''));
					});
					section(pagesBox, 'GitHub Pages', [ulb, staleNote(from.builds)]);
				}

				// Commits.
				if (!commits) section(commitsBox, 'Latest commits on ' + api.site.branch, ui.errorBox(explain(got[0].err, 'The commits could not be read'), retry));
				else {
					var ulc = h('ul', { class: 'th-runs', id: 'health-commit-list' });
					commits.slice(0, 8).forEach(function (c) {
						var isLive = live && c.sha === live.sha;
						ulc.appendChild(runLine(isLive ? 'ok' : 'muted', c.short, c.message, (c.author ? c.author + ', ' : '') + ui.date.ago(c.date) + (isLive ? ' (live)' : ''), c.url));
					});
					section(commitsBox, 'Latest commits on ' + api.site.branch, [ulc, staleNote(from.commits)]);
				}

				// Actions.
				if (!groups) section(runsBox, 'Actions', ui.errorBox(explain(got[2].err, 'The Actions runs could not be read'), retry));
				else if (!groups.length) section(runsBox, 'Actions', h('p', { class: 'th-empty', text: 'No workflow has run yet.' }));
				else {
					var nodes = [];
					groups.forEach(function (g) {
						nodes.push(h('h4', { class: 'th-group', text: g.name }));
						var ulr = h('ul', { class: 'th-runs', data: { workflow: g.path || g.key } });
						g.runs.forEach(function (r) {
							ulr.appendChild(runLine(KIND[r.state.kind] || 'warn', r.state.label, (r.number ? '#' + r.number + ' ' : '') + (r.title || g.name), (r.event ? r.event + ', ' : '') + 'commit ' + r.short + ', ' + ui.date.ago(r.date), r.url));
						});
						nodes.push(ulr);
					});
					nodes.push(staleNote(from.runs));
					section(runsBox, 'Actions', nodes);
				}

				var rate = api.gh.rateSeen && api.gh.rateSeen();
				deployNote.textContent = 'Asked ' + ui.date.time(data.at) + '.' + (rate && rate.limit ? ' ' + rate.remaining + ' of ' + rate.limit + ' GitHub requests left this hour.' : '');
			}

			// ---- start -------------------------------------------------------------------------
			drawChecks(null);
			var first = api.store.get(VIEW, 'last', null).then(
				function (saved) {
					if (!m.alive) return;
					if (saved && saved.roll && saved.results) {
						drawSummary(saved, false);
						drawChecks(saved.results);
						runBtn.lastChild.textContent = 'Run again';
						if (!lastSummary) lastSummary = { state: saved.roll.state, text: saved.text, at: saved.at };
					} else drawSummary(null, false);
				},
				function () {
					drawSummary(null, false);
				}
			);
			return Promise.all([first, loadDeploys()]).then(function () {
				if (m.alive && api.params && api.params.run === '1') runChecks();
			});
		});
	}

	function unmount() {
		var m = M;
		M = null;
		if (!m) return;
		m.alive = false;
		if (m.abort) m.abort.abort();
	}

	var view = {
		id: VIEW,
		title: 'Health',
		icon: 'health',
		order: 60,
		mount: mount,
		unmount: unmount,
	};
	// The Home tile shows the last result once this page has seen one.
	Object.defineProperty(view, 'description', {
		enumerable: true,
		get: function () {
			if (!lastSummary) return DEFAULT_DESCRIPTION;
			var C = window.DeskChecks;
			var ago = window.DeskUI && window.DeskUI.date ? window.DeskUI.date.ago(lastSummary.at) : '';
			return C ? C.homeLine(lastSummary, ago) : lastSummary.text;
		},
	});

	if (window.Desk && window.Desk.registerView) window.Desk.registerView(view);
})();
