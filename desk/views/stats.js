// Desk view "stats": visitor numbers from GoatCounter and the latest comments
// from giscus (GitHub Discussions in the site repository).
//
// Visitors come in one of three modes, and the page says which and why:
//   api      GoatCounter's API with the owner's token (kept with api.secrets,
//            name "goatcounter"): views per day, top pages, referrers,
//            countries, browsers, systems.
//   counter  no token, or the API refused: the public per-path counters that
//            assets/js/blog.js reads (/counter/<path>.json), for the whole
//            site and for every post.
//   cached   neither answered: the last copy saved on this device.
// Comments are read with api.gh.graphql and are shown as text only.
// "Since you last looked" keeps two times in the settings (stats.lastSeen,
// stats.seenBefore). The arithmetic is in desk/statsmath.js (tested by
// desk/test/test-stats.mjs); this file is DOM and requests.
//
// Nothing here identifies a visitor: GoatCounter's API gives only counts.

(function () {
	'use strict';

	var SVG_NS = 'http://www.w3.org/2000/svg';
	var GAP_MS = 300; // GoatCounter allows 4 requests a second; stay under it
	var RANGES = [7, 30, 90];
	var COMMENT_DISCUSSIONS = 25;

	var mathPromise = null;
	var run = null; // the mounted view's state

	// ---- files this view needs -------------------------------------------------------

	function loadMath() {
		if (window.DeskStatsMath) return Promise.resolve(window.DeskStatsMath);
		if (!mathPromise) {
			mathPromise = new Promise(function (resolve, reject) {
				var s = document.createElement('script');
				s.src = 'statsmath.js';
				s.onload = function () {
					if (window.DeskStatsMath) resolve(window.DeskStatsMath);
					else reject(new Error('statsmath.js loaded but defined nothing.'));
				};
				s.onerror = function () {
					mathPromise = null;
					if (s.parentNode) s.parentNode.removeChild(s);
					reject(new Error('The Desk could not load statsmath.js. Check the connection and try again.'));
				};
				document.head.appendChild(s);
			});
		}
		return mathPromise;
	}

	function loadCss() {
		if (document.getElementById('desk-stats-css')) return;
		var l = document.createElement('link');
		l.id = 'desk-stats-css';
		l.rel = 'stylesheet';
		l.href = 'views/stats.css';
		document.head.appendChild(l);
	}

	// ---- GoatCounter -------------------------------------------------------------------

	function GoatError(kind, message, extra) {
		var e = new Error(message);
		e.name = 'GoatError';
		e.kind = kind;
		if (extra) Object.keys(extra).forEach(function (k) {
			e[k] = extra[k];
		});
		return e;
	}

	// One client per load: requests go out one at a time, GAP_MS apart.
	function goatClient(base, token, r) {
		var queue = Promise.resolve();
		var last = 0;

		function slot() {
			var p = queue.then(function () {
				var wait = Math.max(0, last + GAP_MS - Date.now());
				return new Promise(function (done) {
					setTimeout(function () {
						last = Date.now();
						done();
					}, wait);
				});
			});
			queue = p;
			return p;
		}

		function query(params) {
			var parts = [];
			Object.keys(params || {}).forEach(function (k) {
				if (params[k] === undefined || params[k] === null || params[k] === '') return;
				parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
			});
			return parts.length ? '?' + parts.join('&') : '';
		}

		// -> { status, data }   (a 404 is an answer, not an error)
		function get(path, params, withToken, retried) {
			return slot().then(function () {
				if (!r.alive) throw GoatError('gone', 'The view was closed.');
				var init = { method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' };
				if (withToken) init.headers = { Authorization: 'Bearer ' + token };
				return fetch(base + path + query(params), init).then(
					function (res) {
						return res.text().then(function (body) {
							var data = null;
							try {
								data = body ? JSON.parse(body) : null;
							} catch (e) {
								data = null;
							}
							var s = res.status;
							if (s === 200) {
								if (data === null) throw GoatError('bad', 'GoatCounter sent an answer the Desk could not read.');
								return { status: s, data: data };
							}
							if (s === 404) return { status: s, data: data };
							if (s === 401) throw GoatError('unauthorized', 'GoatCounter did not accept the token (401). It may have been deleted or mistyped: paste a new one under "GoatCounter" below.');
							if (s === 403) throw GoatError('forbidden', 'GoatCounter refused (403): ' + (withToken ? 'the token lacks the "Read statistics" permission.' : 'the public counters are switched off. Tick "Allow adding visitor counts on your website" in the GoatCounter site settings.'));
							if (s === 429) {
								if (!retried) {
									return new Promise(function (done) {
										setTimeout(done, 1500);
									}).then(function () {
										return get(path, params, withToken, true);
									});
								}
								throw GoatError('ratelimited', 'GoatCounter says too many requests (429). Wait a minute and try again.');
							}
							throw GoatError('server', 'GoatCounter answered with an error (' + s + '). Try again later.', { status: s });
						});
					},
					function () {
						if (navigator.onLine === false) throw GoatError('offline', 'This device is offline.');
						throw GoatError('refused', 'The browser could not get an answer from ' + base.replace(/^https?:\/\//, '') + ': the request was blocked (by the browser\'s cross-origin rules, an extension or a filter) or the network failed.');
					}
				);
			});
		}

		return {
			api: function (endpoint, params) {
				return get('/api/v0/' + endpoint, params, true).then(function (r2) {
					if (r2.status === 404) throw GoatError('server', 'GoatCounter does not know /api/v0/' + endpoint + ' (404).');
					return r2.data;
				});
			},
			// -> a number, 0 for a path never counted, null when the counter gave nothing
			counter: function (path, start) {
				return get('/counter/' + encodeURIComponent(path) + '.json', start ? { start: start } : null, false).then(function (r2) {
					if (r2.status === 404) return 0;
					return window.DeskStatsMath.parseCounter(r2.data);
				});
			},
		};
	}

	// ---- loading -------------------------------------------------------------------------

	function myOffset() {
		return -new Date().getTimezoneOffset();
	}

	function goatOffset(api) {
		var v = api.settings.get('stats.goatZone', null);
		return typeof v === 'number' && isFinite(v) ? v : myOffset();
	}

	function siteIndex(r) {
		var api = r.api;
		function json(path) {
			return fetch(api.siteRoot + path, { cache: 'no-cache', credentials: 'same-origin' })
				.then(function (res) {
					return res.ok ? res.json() : null;
				})
				.catch(function () {
					return null;
				});
		}
		return Promise.all([json('blog/index.json'), json('misc/toys.json')]).then(function (got) {
			var M = r.M;
			if (got[0] || got[1]) {
				var saved = { posts: got[0] || [], toys: got[1] || [] };
				api.store.put('stats', 'index', saved).catch(function () {});
				return M.buildIndex(saved.posts, saved.toys);
			}
			return api.store.get('stats', 'index', null).then(function (saved) {
				return M.buildIndex(saved ? saved.posts : [], saved ? saved.toys : []);
			});
		});
	}

	// The full dashboard from the API.
	function loadApi(r, goat, days) {
		var M = r.M;
		var now = Date.now();
		var R = M.range(now, myOffset(), days);
		var gOff = goatOffset(r.api);
		var since = r.look.since;
		var nowEnd = M.apiTime(M.ceilHour(now));
		var asks = [
			goat.api('stats/total', { start: R.prevStart, end: R.end }),
			goat.api('stats/hits', { start: R.start, end: R.end, limit: 30 }),
			goat.api('stats/toprefs', { start: R.start, end: R.end, limit: 10 }),
			goat.api('stats/locations', { start: R.start, end: R.end, limit: 10 }),
			goat.api('stats/browsers', { start: R.start, end: R.end, limit: 6 }),
			goat.api('stats/systems', { start: R.start, end: R.end, limit: 6 }),
		];
		if (since != null) {
			var from = M.apiTime(M.floorHour(since));
			asks.push(goat.api('stats/total', { start: from, end: nowEnd }));
			asks.push(goat.api('stats/hits', { start: from, end: nowEnd, limit: 5 }));
		}
		return Promise.all(asks).then(function (got) {
			var totalStats = (got[0] && got[0].stats) || [];
			var daily = function (keys) {
				if (gOff === myOffset()) return M.series(totalStats, keys);
				var map = M.rebucket(totalStats, gOff, myOffset());
				return keys.map(function (k) {
					return { day: k, count: map[k] || 0 };
				});
			};
			var series = daily(R.keys);
			var prev = daily(R.prevKeys);
			var zone = M.compareDays(totalStats, R.prevKeys.concat(R.keys));
			var model = {
				mode: 'api',
				days: days,
				at: now,
				offset: myOffset(),
				goatOffset: gOff,
				zoneSet: typeof r.api.settings.get('stats.goatZone', null) === 'number',
				zone: zone,
				series: series,
				total: M.sum(series),
				prevTotal: M.sum(prev),
				hits: ((got[1] && got[1].hits) || []).map(slimHit),
				hitsMore: !!(got[1] && got[1].more),
				refs: (got[2] && got[2].stats) || [],
				locs: (got[3] && got[3].stats) || [],
				browsers: (got[4] && got[4].stats) || [],
				systems: (got[5] && got[5].stats) || [],
				since: null,
			};
			if (since != null) {
				model.since = {
					at: since,
					views: M.sum(((got[6] && got[6].stats) || []).map(function (e) {
						return M.dayCount(e);
					})),
					hits: ((got[7] && got[7].hits) || []).map(slimHit),
					exact: true,
				};
			}
			return model;
		});
	}

	function slimHit(h) {
		return { path: h && h.path, title: h && h.title, count: h && h.count, event: !!(h && h.event) };
	}

	// The public counters: the whole site, a week by day, and every post.
	function loadCounter(r, goat, days, reason) {
		var M = r.M;
		var now = Date.now();
		var utcToday = M.dayKey(now, 0);
		var chartKeys = M.dayList(utcToday, 7);
		var rangeKeys = M.dayList(utcToday, days);
		var prevStart = M.addDays(rangeKeys[0], -days);
		var memo = {};
		function count(path, start) {
			var k = path + '|' + (start || '');
			if (!memo[k]) memo[k] = goat.counter(path, start);
			return memo[k];
		}
		var posts = Object.keys(r.index.posts);
		// The whole site first: if it fails, nothing else is asked.
		return count('TOTAL', '').then(function (allTime) {
			if (allTime === null) throw GoatError('server', 'GoatCounter\'s public counter gave no number for the whole site.');
			var asks = chartKeys.map(function (k) {
				return count('TOTAL', k);
			});
			asks.push(count('TOTAL', rangeKeys[0]));
			asks.push(count('TOTAL', prevStart));
			var since = r.look.since;
			asks.push(since != null ? count('TOTAL', M.dayKey(since, 0)) : Promise.resolve(null));
			posts.forEach(function (slug) {
				asks.push(count('/post/' + slug, rangeKeys[0]));
				asks.push(count('/post/' + slug, ''));
			});
			return Promise.all(asks).then(function (got) {
				var points = chartKeys.map(function (k, i) {
					return { day: k, since: got[i] };
				});
				var i = chartKeys.length;
				var inRange = got[i] || 0;
				var fromPrev = got[i + 1] || 0;
				var sinceViews = got[i + 2];
				var rows = posts.map(function (slug, j) {
					return { path: '/post/' + slug, count: got[i + 3 + 2 * j] || 0, allTime: got[i + 4 + 2 * j] || 0 };
				});
				return {
					mode: 'counter',
					reason: reason,
					days: days,
					at: now,
					offset: 0,
					series: M.sinceToDaily(points),
					total: inRange,
					prevTotal: Math.max(0, fromPrev - inRange),
					allTime: allTime,
					posts: rows,
					since: since != null ? { at: since, views: sinceViews, exact: false, fromDay: M.dayKey(since, 0), hits: [] } : null,
				};
			});
		});
	}

	function loadVisitors(r, days) {
		var api = r.api;
		return Promise.all([api.goatBase(), api.secrets.get('goatcounter')]).then(function (got) {
			var base = got[0];
			var token = got[1];
			if (!base) throw GoatError('config', 'assets/js/config.json names no GoatCounter site (goatCounterCode), so there is nothing to ask.');
			r.goatBase = base;
			var goat = goatClient(base, token, r);
			if (!token) return loadCounter(r, goat, days, { kind: 'notoken', text: 'No GoatCounter token is saved on this device, so only the public counters can be read.' });
			return loadApi(r, goat, days).catch(function (err) {
				if (!r.alive || err.kind === 'offline') throw err;
				return loadCounter(r, goat, days, { kind: err.kind || 'error', text: 'GoatCounter\'s API could not be used: ' + err.message });
			});
		});
	}

	// ---- comments ------------------------------------------------------------------------

	var COMMENTS_QUERY = [
		'query ($owner: String!, $name: String!, $n: Int!, $categoryId: ID) {',
		'  repository(owner: $owner, name: $name) {',
		'    discussions(first: $n, categoryId: $categoryId, orderBy: { field: UPDATED_AT, direction: DESC }) {',
		'      nodes {',
		'        number title url updatedAt category { name }',
		'        comments(last: 30) {',
		'          totalCount',
		'          nodes {',
		'            id url createdAt bodyText isMinimized author { login }',
		'            replies(last: 20) { totalCount nodes { id url createdAt bodyText isMinimized author { login } } }',
		'          }',
		'        }',
		'      }',
		'    }',
		'  }',
		'}',
	].join('\n');

	function loadComments(r) {
		var api = r.api;
		return api.siteConfig().then(function (cfg) {
			var g = (cfg && cfg.giscus) || {};
			return api.gh
				.graphql(COMMENTS_QUERY, { owner: api.site.owner, name: api.site.repo, n: COMMENT_DISCUSSIONS, categoryId: g.categoryId || null })
				.then(function (data) {
					var list = (data && data.repository && data.repository.discussions && data.repository.discussions.nodes) || [];
					var items = r.M.flattenComments(list, { index: r.index, category: g.category || '', me: api.user().login });
					var saved = { at: Date.now(), items: items.slice(0, 60) };
					api.store.put('stats', 'comments', saved).catch(function () {});
					return { items: saved.items, at: saved.at, cached: false, category: g.category || '' };
				});
		});
	}

	// ---- rendering helpers ------------------------------------------------------------------

	function h(tag, props, children) {
		return run.api.ui.el(tag, props, children);
	}

	function card(title, id, extra) {
		var head = h('div', { class: 'card-head' }, [h('h2', { id: id + '-h', text: title })].concat(extra || []));
		var body = h('div', { class: 'stats-body' });
		var c = h('section', { class: 'card stats-card', id: id, 'aria-labelledby': id + '-h' }, [head, body]);
		return { node: c, body: body, head: head };
	}

	function siteLink(link, text) {
		if (!link) return h('span', { class: 'stats-name', text: text });
		return h('a', { class: 'stats-name', href: run.api.siteUrl + link, target: '_blank', rel: 'noopener noreferrer', text: text });
	}

	function githubLink(url, text) {
		var safe = run.M.githubUrl(url);
		if (!safe) return h('span', { class: 'muted', text: text + ' (no link)' });
		return h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', class: 'stats-ext' }, [text, run.api.ui.icon('external', 14)]);
	}

	function bar(part) {
		var pct = Math.round(Math.max(0, Math.min(1, part || 0)) * 1000) / 10;
		return h('span', { class: 'stats-bar', 'aria-hidden': 'true' }, [h('span', { style: { width: pct + '%' } })]);
	}

	// A ranked list: [{ name (node or text), detail, count, share, part }]
	function rankList(rows, label, empty) {
		if (!rows.length) return h('p', { class: 'muted small', text: empty || 'Nothing in this period.' });
		var ol = h('ol', { class: 'stats-rank', 'aria-label': label });
		rows.forEach(function (row) {
			var name = typeof row.name === 'string' ? h('span', { class: 'stats-name', text: row.name }) : row.name;
			var left = h('div', { class: 'stats-rank-name' }, [name]);
			if (row.detail) left.appendChild(h('div', { class: 'stats-detail mono', text: row.detail }));
			ol.appendChild(
				h('li', {}, [
					left,
					h('div', { class: 'stats-rank-num' }, [h('span', { class: 'stats-count', text: run.M.fmt(row.count) }), row.share ? h('span', { class: 'stats-share muted', text: row.share }) : null].filter(Boolean)),
					bar(row.part),
				])
			);
		});
		return ol;
	}

	// ---- the chart ---------------------------------------------------------------------------

	function svg(tag, attrs, text) {
		var n = document.createElementNS(SVG_NS, tag);
		Object.keys(attrs || {}).forEach(function (k) {
			n.setAttribute(k, String(attrs[k]));
		});
		if (text != null) n.textContent = text;
		return n;
	}

	function drawChart(host, model, summaryId) {
		var M = run.M;
		run.api.ui.clear(host);
		var width = Math.max(280, Math.min(900, Math.round(host.clientWidth || 640)));
		var narrow = width < 480;
		var L = M.chartLayout(model.series, { width: width, height: narrow ? 180 : 210, left: 34, right: 6, top: 12, bottom: 26, maxBar: 28, maxLabels: narrow ? 4 : model.series.length <= 7 ? 7 : 6, steps: 3 });
		var root = svg('svg', { viewBox: '0 0 ' + L.width + ' ' + L.height, width: L.width, height: L.height, role: 'img', 'aria-labelledby': summaryId, class: 'stats-chart', focusable: 'false' });
		L.ticks.forEach(function (t) {
			root.appendChild(svg('line', { x1: L.plot.x, x2: L.plot.x + L.plot.w, y1: t.y, y2: t.y, class: t.value === 0 ? 'axis' : 'grid' }));
			root.appendChild(svg('text', { x: L.plot.x - 6, y: t.y + 4, 'text-anchor': 'end', class: 'tick' }, M.fmt(t.value)));
		});
		L.bars.forEach(function (b) {
			var g = svg('g', { class: 'day' });
			g.appendChild(svg('rect', { x: b.slotX, y: L.plot.y, width: b.slotW, height: L.plot.h, class: 'hit' }));
			if (b.d) g.appendChild(svg('path', { d: b.d, class: 'bar' + (b.i === L.peak ? ' peak' : '') + (b.i === L.bars.length - 1 ? ' today' : '') }));
			g.appendChild(svg('title', {}, M.longDay(b.day) + ': ' + M.fmt(b.count) + (b.count === 1 ? ' view' : ' views')));
			root.appendChild(g);
		});
		L.labels.forEach(function (lab, k) {
			var anchor = k === L.labels.length - 1 && lab.x > L.width - 30 ? 'end' : 'middle';
			root.appendChild(svg('text', { x: anchor === 'end' ? L.width - 2 : lab.x, y: L.height - 7, 'text-anchor': anchor, class: 'tick' }, M.shortDay(lab.day)));
		});
		host.appendChild(root);
	}

	// ---- the visitors part --------------------------------------------------------------------

	function modeNotice(model, cachedBecause) {
		var M = run.M;
		var ui = run.api.ui;
		var badge;
		var text;
		if (cachedBecause) {
			badge = h('span', { class: 'badge badge-warn', text: 'Saved copy' });
			text = 'GoatCounter could not be reached (see above). This is what the Desk saw ' + ui.date.ago(model.at) + ' (' + ui.date.long(new Date(model.at)) + ', ' + ui.date.time(new Date(model.at)) + ').';
		} else if (model.mode === 'api') {
			badge = h('span', { class: 'badge badge-ok', text: 'Full: GoatCounter API' });
			text = 'Read with your GoatCounter token. Days run midnight to midnight on this device\'s clock (' + M.offsetName(model.offset) + ').';
		} else {
			badge = h('span', { class: 'badge badge-accent', text: 'Public counters' });
			text = (model.reason ? model.reason.text + ' ' : '') + 'They give totals for the whole site and for each post, by UTC day; GoatCounter may keep an answer for a few hours before counting again. Top pages, referrers and countries need the API.';
		}
		return h('div', { class: 'stats-mode', 'data-mode': cachedBecause ? 'cached' : model.mode }, [badge, h('p', { class: 'small', text: text })]);
	}

	function renderVisitors(model, cachedBecause) {
		var r = run;
		var M = r.M;
		var ui = r.api.ui;
		var host = r.parts.visitors;
		ui.clear(host);
		host.appendChild(modeNotice(model, cachedBecause));

		// zone check (API only)
		if (model.mode === 'api' && model.zone && model.zone.known && !model.zone.same && !model.zoneSet) {
			host.appendChild(
				ui.notice(
					'GoatCounter\'s days do not line up with this device\'s: asked for ' + M.shortDay(M.addDays(model.series[0].day, -model.days)) + ' to ' + M.shortDay(model.series[model.series.length - 1].day) + ', it answered ' + M.shortDay(model.zone.first) + ' to ' + M.shortDay(model.zone.last) + '. Its account probably uses another time zone; choose it under "GoatCounter" below so the views are moved to the right days.',
					'warn'
				)
			);
		}

		// tiles
		var c = M.change(model.total, model.prevTotal);
		var span = model.mode === 'counter' ? model.days + ' days (UTC)' : model.days + ' days';
		var tiles = h('div', { class: 'stats-tiles' }, [
			tile('Views, last ' + span, M.fmt(model.total)),
			tile('The ' + model.days + ' days before', M.fmt(model.prevTotal), c.label ? h('span', { class: 'stats-change', 'data-dir': c.dir, text: c.label }) : null),
			model.mode === 'counter' ? tile('All time', M.fmt(model.allTime)) : tile('A day, on average', avgText(model.total / model.days)),
		]);
		host.appendChild(tiles);

		// chart
		var chartTitle = model.mode === 'counter' ? 'The last 7 days, by UTC day' : 'Views per day';
		var sumId = 'stats-chart-sum';
		var summary = M.summarize(model.series, { prevTotal: model.mode === 'counter' && model.days !== 7 ? null : model.prevTotal });
		var chartHost = h('div', { class: 'stats-chart-host' });
		var table = h('table', { class: 'stats-table small' }, [
			h('thead', {}, [h('tr', {}, [h('th', { scope: 'col', text: 'Day' }), h('th', { scope: 'col', text: 'Views' })])]),
			h(
				'tbody',
				{},
				model.series
					.slice()
					.reverse()
					.map(function (p) {
						return h('tr', {}, [h('td', { text: M.longDay(p.day, true) }), h('td', { text: M.fmt(p.count) })]);
					})
			),
		]);
		host.appendChild(
			h('div', { class: 'stats-chart-wrap' }, [
				h('h3', { class: 'stats-sub', text: chartTitle }),
				chartHost,
				h('p', { id: sumId, class: 'stats-summary', text: summary }),
				h('details', { class: 'stats-numbers' }, [h('summary', { text: 'The numbers, day by day' }), table]),
			])
		);
		r.chart = { host: chartHost, model: model, sumId: sumId };
		drawChart(chartHost, model, sumId);

		// pages
		if (model.mode === 'api') {
			var rows = M.joinPages(model.hits, r.index, { total: model.total }).slice(0, 15);
			var pages = rows.map(function (row) {
				return { name: siteLink(row.link, row.title), detail: row.detail, count: row.count, share: row.share, part: row.part };
			});
			host.appendChild(
				h('div', { class: 'stats-block' }, [
					h('h3', { class: 'stats-sub', text: 'Top pages' }),
					rankList(pages, 'Top pages', 'No page was viewed in this period.'),
					model.hitsMore ? h('p', { class: 'muted small', text: 'GoatCounter has more pages; the Desk asked for the top 30.' }) : null,
				].filter(Boolean))
			);
			var grid = h('div', { class: 'stats-grid' });
			grid.appendChild(listBlock('Referrers', M.topList(model.refs, { blank: 'Direct, or no referrer sent' })));
			grid.appendChild(listBlock('Countries', M.topList(model.locs, { blank: 'Unknown' })));
			grid.appendChild(listBlock('Browsers', M.topList(model.browsers, { blank: 'Unknown' })));
			grid.appendChild(listBlock('Systems', M.topList(model.systems, { blank: 'Unknown' })));
			host.appendChild(grid);
			host.appendChild(h('p', { class: 'muted small', text: 'Referrers, countries, browsers and systems are counted by UTC day. Shares are of all views in the period. GoatCounter counts a visitor once per page per visit and keeps nothing that identifies a person; neither does this page.' }));
		} else {
			var postRows = model.posts
				.map(function (p) {
					var d = M.describe(p.path, r.index);
					return { name: siteLink(d.link, d.title), detail: M.fmt(p.allTime) + ' all time', count: p.count, part: 0 };
				})
				.sort(function (a, b) {
					return b.count - a.count;
				});
			var most = postRows.reduce(function (m, p) {
				return Math.max(m, p.count);
			}, 0);
			postRows.forEach(function (p) {
				p.part = most ? p.count / most : 0;
			});
			host.appendChild(
				h('div', { class: 'stats-block' }, [
					h('h3', { class: 'stats-sub', text: 'Posts, last ' + span }),
					rankList(postRows, 'Posts', 'No published posts were found in blog/index.json.'),
				])
			);
		}
	}

	function tile(label, value, extra) {
		return h('div', { class: 'stats-tile' }, [h('div', { class: 'stats-tile-label small muted', text: label }), h('div', { class: 'stats-tile-value' }, [h('span', { text: value }), extra || null].filter(Boolean))]);
	}

	function avgText(v) {
		return v >= 10 ? run.M.fmt(Math.round(v)) : String(Math.round(v * 10) / 10);
	}

	function listBlock(title, rows) {
		return h('div', { class: 'stats-block' }, [
			h('h3', { class: 'stats-sub', text: title }),
			rankList(
				rows.slice(0, 8).map(function (r2) {
					return { name: r2.name, count: r2.count, share: r2.share, part: r2.part };
				}),
				title
			),
		]);
	}

	// ---- since you last looked ------------------------------------------------------------------

	function renderSince() {
		var r = run;
		var M = r.M;
		var ui = r.api.ui;
		var host = r.parts.since;
		ui.clear(host);
		if (r.look.since == null) {
			host.appendChild(h('p', { text: 'This is the first look the Desk has recorded. From your next visit on, this card shows what came in since the last one.' }));
			return;
		}
		var at = new Date(r.look.since);
		host.appendChild(h('p', {}, ['You last looked ', h('strong', { text: ui.date.ago(at) }), ' (' + ui.date.long(at) + ', ' + ui.date.time(at) + ').']));
		var ul = h('ul', { class: 'stats-since' });
		var v = r.visitors;
		if (v && v.since) {
			if (v.since.views == null) ul.appendChild(h('li', { text: 'Views since then: the counter gave no number.' }));
			else if (v.since.exact) ul.appendChild(h('li', {}, [h('strong', { text: M.fmt(v.since.views) }), v.since.views === 1 ? ' view since then.' : ' views since then.']));
			else ul.appendChild(h('li', {}, [h('strong', { text: M.fmt(v.since.views) }), (v.since.views === 1 ? ' view' : ' views') + ' since the start of ' + M.longDay(v.since.fromDay) + ' (UTC): the public counter counts whole days.']));
			if (v.since.hits && v.since.hits.length) {
				var top = M.joinPages(v.since.hits, r.index).slice(0, 3);
				ul.appendChild(
					h('li', {}, ['Most of them on '].concat(
						top.reduce(function (acc, row, i) {
							if (i) acc.push(i === top.length - 1 ? ' and ' : ', ');
							acc.push(siteLink(row.link, row.title));
							acc.push(' (' + M.fmt(row.count) + ')');
							return acc;
						}, []),
						['.']
					))
				);
			}
		} else if (r.visitorsFailed) {
			ul.appendChild(h('li', { class: 'muted', text: 'Views since then: GoatCounter could not be reached.' }));
		} else {
			ul.appendChild(h('li', { class: 'muted', text: 'Views since then: loading...' }));
		}
		var cm = r.comments;
		if (cm) {
			var fresh = cm.items.filter(function (c) {
				return M.isNew(c, r.look.since);
			}).length;
			ul.appendChild(
				h('li', {}, [
					h('strong', { text: String(fresh) }),
					fresh === 1 ? ' new comment or reply' : ' new comments or replies',
					fresh ? [' (', h('a', { href: '#stats-comments', on: { click: jumpToComments }, text: 'see below' }), ').'] : '.',
				])
			);
		} else if (r.commentsFailed) {
			ul.appendChild(h('li', { class: 'muted', text: 'New comments: GitHub could not be reached.' }));
		}
		host.appendChild(ul);
	}

	function jumpToComments(e) {
		e.preventDefault();
		var target = document.getElementById('stats-comments');
		if (!target) return;
		var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
		var head = document.getElementById('stats-comments-h');
		if (head) {
			head.setAttribute('tabindex', '-1');
			head.focus({ preventScroll: true });
		}
	}

	// ---- comments ------------------------------------------------------------------------------

	function renderComments(result, cachedBecause) {
		var r = run;
		var M = r.M;
		var ui = r.api.ui;
		var host = r.parts.comments;
		ui.clear(host);
		if (cachedBecause) host.appendChild(ui.notice('GitHub could not be reached: ' + cachedBecause + ' These are the comments the Desk saw ' + ui.date.ago(result.at) + '.', 'warn'));
		var items = result.items;
		if (!items.length) {
			host.appendChild(h('p', { class: 'muted', text: 'No comments yet' + (result.category ? ' in the "' + result.category + '" discussions.' : '.') }));
			return;
		}
		var fresh = items.filter(function (c) {
			return M.isNew(c, r.look.since);
		}).length;
		host.appendChild(h('p', { class: 'small muted', text: items.length + (items.length === 1 ? ' comment or reply' : ' comments and replies') + ', newest first' + (fresh ? '; ' + fresh + ' new since your last look.' : '.') + ' Comments are written by visitors: shown here as plain text.' }));
		var ol = h('ol', { class: 'stats-comments' });
		items.slice(0, 40).forEach(function (c) {
			var isNew = M.isNew(c, r.look.since);
			var when = new Date(c.at);
			var post = c.known ? siteLink('#/post/' + encodeURIComponent(c.slug), c.postTitle) : h('span', { class: 'stats-name', text: '"' + c.slug + '" (no published post has this name)' });
			var head = h('div', { class: 'stats-c-head' }, [
				h('span', { class: 'stats-c-author', text: c.author + (c.mine ? ' (you)' : '') }),
				h('span', { class: 'muted', text: c.kind === 'reply' ? ' replied' + (c.replyTo ? ' to ' + c.replyTo : '') + ' on ' : ' commented on ' }),
				post,
			]);
			var meta = h('div', { class: 'stats-c-meta small muted' }, [h('time', { datetime: new Date(c.at).toISOString(), title: ui.date.long(when) + ' ' + ui.date.time(when), text: ui.date.ago(when) })]);
			if (isNew) meta.insertBefore(h('span', { class: 'badge badge-accent', text: 'New' }), meta.firstChild);
			if (c.hidden) meta.appendChild(h('span', { class: 'badge badge-warn', text: 'Hidden on GitHub' }));
			var ex = M.excerpt(c.text, 420);
			var body = h('p', { class: 'stats-c-text', text: ex.text || '(empty)' });
			var actions = h('div', { class: 'stats-c-actions' });
			if (c.hidden) {
				body.hidden = true;
				actions.appendChild(
					ui.button('Show the hidden text', {
						kind: 'quiet',
						onClick: function (e) {
							body.hidden = false;
							e.currentTarget.remove();
						},
					})
				);
			}
			if (ex.cut) {
				var more = ui.button('Show all', {
					kind: 'quiet',
					onClick: function () {
						var whole = body.textContent === c.text;
						body.textContent = whole ? ex.text : c.text;
						more.lastChild.textContent = whole ? 'Show all' : 'Show less';
						more.setAttribute('aria-expanded', whole ? 'false' : 'true');
					},
				});
				more.setAttribute('aria-expanded', 'false');
				actions.appendChild(more);
			}
			actions.appendChild(githubLink(c.url, 'Open on GitHub'));
			ol.appendChild(h('li', { class: 'stats-comment', 'data-new': isNew ? 'true' : 'false' }, [head, meta, body, actions]));
		});
		host.appendChild(ol);
	}

	// ---- the GoatCounter settings card ----------------------------------------------------------------

	function renderToken(hasToken) {
		var r = run;
		var ui = r.api.ui;
		var host = r.parts.token;
		ui.clear(host);
		var where = (r.goatBase || 'https://nietztein.goatcounter.com').replace(/\/+$/, '');
		var real = /^https:\/\/[a-z0-9-]+\.goatcounter\.com$/.test(where) ? where : 'https://nietztein.goatcounter.com';
		host.appendChild(
			h('p', { class: 'small' }, [
				hasToken ? 'A GoatCounter token is saved on this device, encrypted with your passphrase. ' : 'No GoatCounter token on this device. ',
				'Make one at ',
				h('a', { href: real + '/user/api', target: '_blank', rel: 'noopener noreferrer', text: real.replace(/^https:\/\//, '') + '/user/api' }),
				' with only "Read statistics" ticked, and paste it here. It is kept on this device only; paste it on each device.',
			])
		);
		var input = h('input', { class: 'input mono', type: 'password', autocomplete: 'off', spellcheck: 'false', id: 'stats-token', placeholder: hasToken ? 'Paste a new token to replace it' : 'GoatCounter API token' });
		var msg = h('p', { class: 'small', role: 'status', 'aria-live': 'polite', id: 'stats-token-msg' });
		var save = ui.button('Check and save', {
			kind: 'primary',
			id: 'stats-token-save',
			onClick: function () {
				var token = input.value.trim();
				if (!token) {
					msg.textContent = 'Paste the token first.';
					input.focus();
					return;
				}
				if (!/^[\x21-\x7e]{8,200}$/.test(token)) {
					msg.textContent = 'That does not look like a GoatCounter token (letters and digits, no spaces).';
					return;
				}
				ui.busy(
					save,
					checkToken(token).then(
						function (warning) {
							return r.api.secrets.set('goatcounter', token).then(function () {
								input.value = '';
								ui.toast(warning ? 'Token saved; it could not be checked.' : 'Token checked and saved.', { kind: warning ? 'warn' : 'ok' });
								if (r.alive) reload();
							});
						},
						function (err) {
							msg.textContent = 'Not saved: ' + err.message;
						}
					)
				);
			},
		});
		var remove = hasToken
			? ui.button('Remove from this device', {
					kind: 'danger',
					id: 'stats-token-remove',
					onClick: function () {
						ui.confirm({ title: 'Remove the GoatCounter token?', body: 'This device will show the public counters only, until you paste a token again. The token itself stays valid at GoatCounter.', action: 'Remove', danger: true }).then(function (ok) {
							if (!ok) return;
							r.api.secrets.set('goatcounter', null).then(function () {
								ui.toast('Token removed from this device.');
								if (r.alive) reload();
							});
						});
					},
			  })
			: null;
		host.appendChild(ui.field('GoatCounter API token', input));
		host.appendChild(h('div', { class: 'actions' }, [save, remove].filter(Boolean)));
		host.appendChild(msg);

		// the account's time zone
		var zone = h('select', { class: 'input', id: 'stats-zone' });
		var current = r.api.settings.get('stats.goatZone', null);
		zone.appendChild(h('option', { value: '', text: 'The same as this device (' + r.M.offsetName(myOffset()) + ')' }));
		for (var m = -12 * 60; m <= 14 * 60; m += 30) {
			if (m % 60 && [-570, -210, 210, 270, 330, 390, 570, 630].indexOf(m) === -1) continue;
			zone.appendChild(h('option', { value: String(m), text: r.M.offsetName(m), selected: typeof current === 'number' && current === m }));
		}
		zone.addEventListener('change', function () {
			var v = zone.value === '' ? null : Number(zone.value);
			r.api.settings.set('stats.goatZone', v === null ? undefined : v).then(function () {
				ui.toast('Saved. The views are moved to the right days on the next load.');
				if (r.alive) reload();
			}, function (err) {
				ui.toast(err.message, { kind: 'bad' });
			});
		});
		host.appendChild(ui.field('Time zone of the GoatCounter account', zone, 'GoatCounter cuts days in the zone set under Settings, then "Your settings". If it is not this device\'s, say which, so each view lands on the right day here. Kept in the Desk settings, shared by your devices.'));
	}

	// -> resolves with '' when GoatCounter accepted it, or a warning text when
	//    it could not be asked; rejects when GoatCounter refused it.
	function checkToken(token) {
		var r = run;
		return r.api.goatBase().then(function (base) {
			if (!base) throw new Error('No GoatCounter site is configured.');
			var goat = goatClient(base, token, r);
			var M = r.M;
			var now = Date.now();
			return goat.api('stats/total', { start: M.apiTime(M.floorHour(now) - M.HOUR), end: M.apiTime(M.floorHour(now)) }).then(
				function () {
					return '';
				},
				function (err) {
					if (err.kind === 'refused' || err.kind === 'offline' || err.kind === 'server' || err.kind === 'ratelimited') return err.message;
					throw err;
				}
			);
		});
	}

	// ---- the page --------------------------------------------------------------------------------------

	function build(el) {
		var r = run;
		var ui = r.api.ui;
		var seg = h('div', { class: 'stats-seg', role: 'group', 'aria-label': 'Period' });
		RANGES.forEach(function (d) {
			seg.appendChild(
				h('button', {
					type: 'button',
					class: 'btn stats-range',
					'data-days': String(d),
					'aria-pressed': d === r.days ? 'true' : 'false',
					text: d + ' days',
					on: {
						click: function () {
							if (r.days === d) return;
							r.days = d;
							r.api.store.put('stats', 'days', d).catch(function () {});
							Array.prototype.forEach.call(seg.children, function (b) {
								b.setAttribute('aria-pressed', b.getAttribute('data-days') === String(d) ? 'true' : 'false');
							});
							loadVisitorsInto();
						},
					},
				})
			);
		});
		var refresh = ui.button('Refresh', { icon: 'refresh', id: 'stats-refresh', onClick: function () {
			ui.busy(refresh, reload());
		} });
		r.parts = {};
		var top = h('div', { class: 'stats-top' }, [seg, refresh]);
		var since = card('Since you last looked', 'stats-since');
		var visitors = card('Visitors', 'stats-visitors');
		var comments = card('Comments', 'stats-comments');
		var token = card('GoatCounter', 'stats-token-card');
		r.parts.since = since.body;
		r.parts.visitors = visitors.body;
		r.parts.comments = comments.body;
		r.parts.token = token.body;
		r.parts.visitors.appendChild(loading('Asking GoatCounter...'));
		r.parts.comments.appendChild(loading('Asking GitHub for the latest comments...'));
		r.parts.since.appendChild(loading('Loading...'));
		el.appendChild(h('div', { class: 'stats-page' }, [top, since.node, visitors.node, comments.node, token.node]));
	}

	function loading(text) {
		return h('p', { class: 'muted stats-loading', role: 'status', text: text });
	}

	function loadVisitorsInto() {
		var r = run;
		var ui = r.api.ui;
		var gen = ++r.visitorsGen;
		r.visitors = null;
		r.visitorsFailed = false;
		ui.clear(r.parts.visitors);
		r.parts.visitors.appendChild(loading('Asking GoatCounter...'));
		renderSince();
		return loadVisitors(r, r.days).then(
			function (model) {
				if (!r.alive || gen !== r.visitorsGen) return;
				r.visitors = model;
				r.api.store.put('stats', 'visitors:' + r.days, model).catch(function () {});
				renderVisitors(model, '');
				renderSince();
				r.api.secrets.get('goatcounter').then(function (t) {
					if (r.alive) renderToken(!!t);
				});
				recordLook();
			},
			function (err) {
				if (!r.alive || gen !== r.visitorsGen) return;
				return r.api.store.get('stats', 'visitors:' + r.days, null).then(function (saved) {
					if (!r.alive || gen !== r.visitorsGen) return;
					if (saved && saved.series) {
						r.visitors = saved;
						renderVisitors(saved, err.message);
						r.parts.visitors.insertBefore(ui.errorBox(err, function () {
							loadVisitorsInto();
						}), r.parts.visitors.firstChild);
					} else {
						r.visitorsFailed = true;
						ui.clear(r.parts.visitors);
						r.parts.visitors.appendChild(ui.errorBox({ message: 'The visitor numbers could not be loaded: ' + err.message + (err.kind === 'offline' ? ' Nothing was saved on this device yet.' : '') }, function () {
							loadVisitorsInto();
						}));
					}
					renderSince();
					r.api.secrets.get('goatcounter').then(function (t) {
						if (r.alive) renderToken(!!t);
					});
				});
			}
		);
	}

	function loadCommentsInto() {
		var r = run;
		var ui = r.api.ui;
		var gen = ++r.commentsGen;
		r.comments = null;
		r.commentsFailed = false;
		ui.clear(r.parts.comments);
		r.parts.comments.appendChild(loading('Asking GitHub for the latest comments...'));
		return loadComments(r).then(
			function (result) {
				if (!r.alive || gen !== r.commentsGen) return;
				r.comments = result;
				renderComments(result, '');
				renderSince();
				recordLook();
			},
			function (err) {
				if (!r.alive || gen !== r.commentsGen) return;
				var E = r.api.gh.errors;
				var message = err.message;
				if (E && err instanceof E.Forbidden) message = 'The token cannot read the site\'s discussions. Give it "Discussions: Read-only" on nietztein.github.io to see comments here.';
				return r.api.store.get('stats', 'comments', null).then(function (saved) {
					if (!r.alive || gen !== r.commentsGen) return;
					ui.clear(r.parts.comments);
					if (saved && saved.items) {
						r.comments = { items: saved.items, at: saved.at, cached: true, category: '' };
						renderComments(r.comments, message);
						r.parts.comments.insertBefore(ui.errorBox({ message: 'Showing a saved copy. ' + message }, function () {
							loadCommentsInto();
						}), r.parts.comments.firstChild);
					} else {
						r.commentsFailed = true;
						r.parts.comments.appendChild(ui.errorBox({ message: 'The comments could not be loaded: ' + message }, function () {
							loadCommentsInto();
						}));
					}
					renderSince();
				});
			}
		);
	}

	// Moves "last looked" forward once something was actually shown.
	function recordLook() {
		var r = run;
		if (!r || r.lookRecorded || !r.look.record) return;
		r.lookRecorded = true;
		var api = r.api;
		Promise.resolve()
			.then(function () {
				return api.settings.set('stats.lastSeen', r.look.record.lastSeen);
			})
			.then(function () {
				return api.settings.set('stats.seenBefore', r.look.record.seenBefore || undefined);
			})
			.catch(function () {
				/* kept for next time; nothing to tell */
			});
	}

	function reload() {
		var r = run;
		if (!r) return Promise.resolve();
		return siteIndex(r).then(function (index) {
			r.index = index;
			return Promise.all([loadVisitorsInto(), loadCommentsInto()]);
		});
	}

	function onResize() {
		var r = run;
		if (!r || r.resizeTimer) return;
		r.resizeTimer = setTimeout(function () {
			r.resizeTimer = null;
			if (r.alive && r.chart && r.chart.host.isConnected) drawChart(r.chart.host, r.chart.model, r.chart.sumId);
		}, 150);
	}

	window.Desk.registerView({
		id: 'stats',
		title: 'Stats',
		icon: 'stats',
		order: 50,
		description: 'Visitors per day, top pages and the latest comments.',

		mount: function (el, api) {
			loadCss();
			var r = (run = { alive: true, api: api, el: el, days: 30, visitorsGen: 0, commentsGen: 0, look: { since: null, record: null }, index: null, lookRecorded: false });
			el.appendChild(api.ui.el('p', { class: 'muted stats-loading', role: 'status', text: 'Loading...' }));
			var settingsReady = Promise.race([
				api.settings.ready(),
				new Promise(function (done) {
					setTimeout(done, 4000);
				}),
			]);
			return Promise.all([loadMath(), api.store.get('stats', 'days', 30), settingsReady])
				.then(function (got) {
					if (!r.alive) return;
					r.M = got[0];
					if (RANGES.indexOf(got[1]) !== -1) r.days = got[1];
					r.look = r.M.lookState(api.settings.get('stats.lastSeen', null), api.settings.get('stats.seenBefore', null), Date.now());
					api.ui.clear(el);
					build(el);
					window.addEventListener('resize', onResize);
					return reload();
				})
				.catch(function (err) {
					if (!r.alive) return;
					api.ui.clear(el);
					el.appendChild(api.ui.errorBox(err, function () {
						api.nav('stats', { t: Date.now() });
					}));
				});
		},

		unmount: function () {
			if (run) {
				run.alive = false;
				clearTimeout(run.resizeTimer);
			}
			window.removeEventListener('resize', onResize);
			run = null;
		},
	});
})();
