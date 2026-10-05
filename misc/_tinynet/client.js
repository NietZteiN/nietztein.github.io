/*
 * TinyNetClient: a promise API over misc/_tinynet/worker.js, for a page.
 *
 *   var net = TinyNetClient.start('../_tinynet/worker.js');
 *   net.init({ p: 41, seed: 1 })
 *     .then(function () { return net.train({ epochs: 1500, every: 10, onProgress: draw }); })
 *     .then(function (end) { ... })
 *     .catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
 *
 * Every method returns a promise. A failure rejects with an Error whose message is a
 * sentence a reader can be shown and whose detail is the technical part. README.md has
 * every method and the shape of what it resolves with.
 */
(function () {
	'use strict';

	function problem(message, detail) {
		var err = new Error(message);
		err.detail = detail || '';
		return err;
	}

	function start(workerUrl) {
		var worker = null, nextId = 1, pending = {}, dead = null, jobs = 0, readyDone = false, readyOk, readyFail, client;
		var ready = new Promise(function (resolve, reject) {
			readyOk = resolve;
			readyFail = reject;
		});
		// Nobody has to listen to `ready`; a failure also rejects every call.
		ready.catch(function () {});

		function die(err) {
			var ids = Object.keys(pending), i, p;
			if (dead) return;
			dead = err;
			if (!readyDone) {
				readyDone = true;
				readyFail(err);
			}
			for (i = 0; i < ids.length; i++) {
				p = pending[ids[i]];
				delete pending[ids[i]];
				p.reject(err);
			}
			jobs = 0;
		}

		function onMessage(e) {
			var m = e.data, p;
			if (!m) return;
			if (m.type === 'ready') {
				if (!readyDone) {
					readyDone = true;
					readyOk({ version: m.version });
				}
				return;
			}
			p = pending[m.id];
			if (!p) return;
			if (m.type === 'progress') {
				if (p.onProgress) {
					try {
						p.onProgress(m.data);
					} catch (err) {
						// The caller's bug, not the worker's: let it surface without breaking the queue.
						setTimeout(function () { throw err; }, 0);
					}
				}
				return;
			}
			delete pending[m.id];
			if (p.job) jobs--;
			if (m.type === 'error') p.reject(problem(friendly(m.message), m.message));
			else p.resolve(m.data);
		}

		function friendly(message) {
			var text = String(message || 'unknown error').replace(/^TinyNet( worker)?: /, '');
			return 'The network could not do that: ' + text + '.';
		}

		function call(cmd, args, onProgress, isJob) {
			if (dead) return Promise.reject(dead);
			return new Promise(function (resolve, reject) {
				var id = nextId++;
				pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress || null, job: !!isJob };
				if (isJob) jobs++;
				try {
					worker.postMessage({ id: id, cmd: cmd, args: args || {} });
				} catch (err) {
					delete pending[id];
					if (isJob) jobs--;
					reject(problem('The request could not be sent to the training worker.', String(err && err.message || err)));
				}
			});
		}

		// Copies the plain options of a call, leaving the callback out (functions cannot be posted).
		function plain(opts) {
			var out = {}, k;
			for (k in opts || {}) if (typeof opts[k] !== 'function') out[k] = opts[k];
			return out;
		}

		try {
			if (typeof Worker !== 'function') throw new Error('This browser has no Web Workers');
			worker = new Worker(workerUrl);
			worker.onmessage = onMessage;
			worker.onerror = function (e) {
				if (e && e.preventDefault) e.preventDefault();
				die(problem('The training code could not be started, so nothing on this page can train.', (e && e.message) || 'The worker script failed to load: ' + workerUrl));
			};
			worker.onmessageerror = function () {
				die(problem('The training worker sent something that could not be read.', 'messageerror'));
			};
		} catch (err) {
			die(problem('The training code could not be started, so nothing on this page can train.', String(err && err.message || err)));
		}

		client = {
			// Resolves with { version } once the worker has loaded its scripts; rejects if it cannot.
			ready: ready,
			// True while a train, unlearn or slice call is running.
			busy: function () {
				return jobs > 0;
			},
			init: function (cfg) {
				return call('init', cfg || {});
			},
			// A trainer in the state of a snapshot from TINYNET_SNAPSHOTS: restore(TINYNET_SNAPSHOTS.grokked).
			restore: function (snapshot) {
				return call('init', { snapshot: snapshot });
			},
			train: function (opts) {
				return call('train', plain(opts), opts && opts.onProgress, true);
			},
			// Ends the running train, unlearn or slice call; that call's promise resolves with stopped: true.
			stop: function () {
				return call('stop');
			},
			metrics: function () {
				return call('metrics');
			},
			weights: function () {
				return call('weights');
			},
			load: function (weights, opts) {
				return call('load', { weights: weights, epoch: opts && opts.epoch });
			},
			reset: function () {
				return call('reset');
			},
			// set({ lr, wd }): change the optimiser's settings, also in the middle of a run.
			set: function (opts) {
				return call('set', plain(opts));
			},
			table: function () {
				return call('table');
			},
			spectrum: function (opts) {
				return call('spectrum', opts);
			},
			norms: function () {
				return call('norms');
			},
			unlearn: function (opts) {
				return call('unlearn', plain(opts), opts && opts.onProgress, true);
			},
			merge: function (other, opts) {
				var a = plain(opts);
				a.other = other;
				return call('merge', a);
			},
			influence: function (query, opts) {
				var a = plain(opts);
				a.query = query;
				return call('influence', a);
			},
			slice: function (opts) {
				return call('slice', plain(opts), opts && opts.onProgress, true);
			},
			// lossAt(weights, 'train' | 'test' | 'all'), or lossAt({ xy: [x, y] }, which) on the plane of the last slice.
			lossAt: function (weights, which) {
				if (weights && weights.xy) return call('lossAt', { xy: weights.xy, which: which });
				return call('lossAt', { weights: weights || null, which: which });
			},
			gradAt: function (weights, which) {
				if (weights && weights.xy) return call('gradAt', { xy: weights.xy, which: which });
				return call('gradAt', { weights: weights || null, which: which });
			},
			evalOn: function (pairs, weights) {
				return call('evalOn', { pairs: pairs, weights: weights || null });
			},
			planeWeights: function (x, y) {
				return call('planeWeights', { x: x, y: y });
			},
			ping: function () {
				return call('ping');
			},
			// Stops the worker for good. Calls still waiting reject.
			terminate: function () {
				if (worker) worker.terminate();
				die(problem('The training worker was shut down.', 'terminate() was called'));
			}
		};
		return client;
	}

	window.TinyNetClient = { start: start };
})();
