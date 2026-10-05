/* misc/_llm/client.js
 *
 * window.LLMClient: loads the model for a page and runs its heavy calls in Web
 * Workers, behind promises.
 *
 *   <script src="../_llm/client.js"></script>
 *   LLMClient.create().then(function (llm) {
 *       var ids = llm.model.encode('Once upon a time');       // cheap calls: straight on the page
 *       return llm.sweep(ids, sets, { onProgress: draw });    // heavy calls: in the workers
 *   }).catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
 *
 * create() fetches the two weight files from this folder (the site's own
 * copy; nothing is asked of any other host), builds a model on the page
 * (llm.model, synchronous, see llm.js) and hands copies of the files to a few
 * workers running worker.js. A sweep is shared out between them. If no worker
 * can be started, the same calls run on the page in short slices instead, and
 * llm.mode says 'main'.
 *
 * README.md is the manual.
 */
(function () {
	'use strict';

	var script = document.currentScript;
	var HERE = script && script.src ? script.src.split(/[?#]/)[0].replace(/[^\/]*$/, '') : '';

	var FILES = [
		{ path: 'weights/stories260K.bin', bytes: 1056540 },
		{ path: 'weights/tok512.bin', bytes: 6227 }
	];
	var TOTAL_BYTES = FILES[0].bytes + FILES[1].bytes;
	var WORKER_WAIT_MS = 15000;
	var MAX_WORKERS = 4;

	// An error a page can show: message is a plain sentence, detail the technical part.
	// plain: true tells ToyKit.fail(err) to show the message to the reader as it is.
	function problem(message, detail) {
		var err = new Error(message);
		err.plain = true;
		err.detail = detail || '';
		return err;
	}

	// A mistake in the page's own call ("LLM: edit 0 (ablate): unit 172 is out of range"):
	// not for a reader's eyes, so ToyKit.fail shows its general sentence and puts this in Details.
	function mistake(message) {
		var err = new Error(message);
		err.plain = false;
		err.detail = message;
		return err;
	}

	function rejected(err) {
		var p = Promise.reject(err);
		p.cancel = function () {};
		return p;
	}

	// null if opts holds only these names, otherwise the rejected promise to return
	function badOptions(LLM, opts, names, where) {
		try {
			LLM.checkOptions(opts, names, where);
			return null;
		} catch (err) {
			return rejected(mistake(textOf(err)));
		}
	}

	function later(fn) {
		setTimeout(fn, 0);
	}

	function textOf(err) {
		return String(err && err.message ? err.message : err);
	}

	function loadLLM(base) {
		if (window.LLM) return Promise.resolve(window.LLM);
		return new Promise(function (resolve, reject) {
			var s = document.createElement('script');
			s.src = base + 'llm.js';
			s.onload = function () {
				if (window.LLM) resolve(window.LLM);
				else reject(problem('The language model could not be started.', 'llm.js loaded but did not define LLM'));
			};
			s.onerror = function () {
				reject(problem('The language model could not be loaded.', 'no answer for ' + s.src));
			};
			document.head.appendChild(s);
		});
	}

	// The whole file as an ArrayBuffer; onBytes(n) is told about each piece as it arrives.
	// With progress this uses XMLHttpRequest, not fetch() with a stream reader: Chrome's
	// devtools protocol (and so the site's test harness) records a fetch body read through
	// getReader() as net::ERR_ABORTED although every byte arrived; XHR is recorded cleanly.
	function fetchBytes(url, onBytes) {
		if (!onBytes || typeof XMLHttpRequest === 'undefined') {
			return fetch(url).then(function (res) {
				if (!res.ok) {
					if (res.body && res.body.cancel) res.body.cancel();
					throw problem('The language model could not be loaded.', url + ' answered ' + res.status);
				}
				return res.arrayBuffer();
			}, function (err) {
				throw problem('The language model could not be loaded.', url + ': ' + textOf(err));
			});
		}
		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest(), seen = 0;
			function more(loaded) {
				if (loaded > seen) {
					onBytes(loaded - seen);
					seen = loaded;
				}
			}
			xhr.open('GET', url);
			xhr.responseType = 'arraybuffer';
			xhr.onprogress = function (e) { more(e.loaded); };
			xhr.onload = function () {
				if (xhr.status < 200 || xhr.status >= 300) {
					reject(problem('The language model could not be loaded.', url + ' answered ' + xhr.status));
					return;
				}
				more(xhr.response.byteLength);
				resolve(xhr.response);
			};
			xhr.onerror = function () {
				reject(problem('The language model could not be loaded.', url + ': the request failed (no connection, or the page was opened from a file)'));
			};
			xhr.onabort = xhr.onerror;
			xhr.send();
		});
	}

	function plainIds(ids) {
		return (ids && typeof ids !== 'string' && typeof ids.length === 'number') ? Array.prototype.slice.call(ids) : ids;
	}

	// A callback of the page must not be able to break the message loop.
	function callHook(fn, a, b, c) {
		try {
			fn(a, b, c);
		} catch (err) {
			later(function () { throw err; });
		}
	}

	// ----------------------------------------------------------------- client

	function Client(LLM, model, base) {
		this.LLM = LLM;
		this.model = model;             // the synchronous model on the page
		this.config = model.config;
		this.vocab = model.vocab;
		this.base = base;
		this.mode = 'main';             // 'worker' once at least one worker has answered
		this.threads = 0;               // how many workers there are
		this.workerError = '';          // why a worker is missing, when one is
		this.workers = [];
		this.host = null;
		this.pending = {};
		this.seq = 0;
		this.turn = 0;
		this.closed = false;
	}

	Client.prototype.post = function (msg, channel) {
		var self = this;
		if (this.workers.length) {
			this.workers[channel % this.workers.length].postMessage(msg);
			return;
		}
		if (!this.host) this.host = this.LLM.host(this.model);
		later(function () {
			self.host.handle(msg, function (reply) { self.receive(reply); });
		});
	};

	Client.prototype.request = function (cmd, args, hooks, channel) {
		var self = this, id = ++this.seq, promise;
		if (channel == null) channel = this.turn++;
		promise = new Promise(function (resolve, reject) {
			if (self.closed) {
				reject(problem('The language model has been closed.', 'close() was called on this client'));
				return;
			}
			self.pending[id] = { cmd: cmd, resolve: resolve, reject: reject, hooks: hooks || {}, channel: channel };
			self.post({ id: id, cmd: cmd, args: args }, channel);
		});
		promise.cancel = function () { self.cancelJob(id); };
		return promise;
	};

	Client.prototype.receive = function (m) {
		var p = m ? this.pending[m.id] : null, i, result;
		if (!p) return;
		if (m.event === 'tokens') {
			if (p.hooks.onToken) for (i = 0; i < m.ids.length; i++) callHook(p.hooks.onToken, m.ids[i], m.texts[i], m.pos + i);
			return;
		}
		if (m.event === 'progress') {
			if (p.hooks.onProgress) callHook(p.hooks.onProgress, m.done, m.total, m);
			return;
		}
		delete this.pending[m.id];
		if (!m.ok) {
			p.reject(mistake(m.error));
			return;
		}
		result = m.result;
		if (p.cmd === 'run') result = this.LLM.wrap(result);
		if (p.cmd === 'generate') {
			result = m.result.ids;
			result.reason = m.result.reason;
		}
		p.resolve(result);
	};

	Client.prototype.cancelJob = function (id) {
		var p = this.pending[id];
		if (p) this.post({ id: ++this.seq, cmd: 'cancel', args: { target: id } }, p.channel);
	};

	// Stop every generate() and sweep() that is still going. Their promises
	// resolve with what they have (see the README).
	Client.prototype.cancel = function () {
		var id;
		for (id in this.pending) {
			if (this.pending[id].cmd === 'generate' || this.pending[id].cmd === 'sweep') this.cancelJob(+id);
		}
	};

	Client.prototype.failAll = function (err) {
		var id, p;
		for (id in this.pending) {
			p = this.pending[id];
			delete this.pending[id];
			p.reject(err);
		}
	};

	Client.prototype.dropWorkers = function () {
		this.workers.forEach(function (w) { w.terminate(); });
		this.workers = [];
		this.threads = 0;
		this.mode = 'main';
	};

	Client.prototype.close = function () {
		this.closed = true;
		this.dropWorkers();
		this.failAll(problem('The language model has been closed.', 'close() was called on this client'));
	};

	// model.run() in a worker: resolves with the same object (flat arrays, shape, accessors).
	Client.prototype.run = function (ids, opts) {
		var bad = badOptions(this.LLM, opts, this.LLM.optionNames.run, 'run');
		if (bad) return bad;
		opts = opts || {};
		return this.request('run', { ids: plainIds(ids), opts: { edits: this.LLM.copyEdits(opts.edits), keep: opts.keep } });
	};

	// model.generate() in a worker: opts.onToken(id, text, pos) is called on the page as tokens arrive.
	Client.prototype.generate = function (ids, opts) {
		var bad = badOptions(this.LLM, opts, this.LLM.optionNames.generate, 'generate');
		if (bad) return bad;
		opts = opts || {};
		return this.request('generate', {
			ids: plainIds(ids),
			opts: {
				maxNew: opts.maxNew, temperature: opts.temperature, topK: opts.topK, seed: opts.seed,
				stopAtBos: opts.stopAtBos, edits: this.LLM.copyEdits(opts.edits)
			}
		}, { onToken: opts.onToken });
	};

	// model.sweep(), shared out between the workers: edit set i goes to worker i mod W, and the
	// answers are put back in order. opts.onProgress(done, total, part) is called as results come;
	// part = { index, kl, pTarget, top, loss } holds the new ones, index saying which edit sets.
	Client.prototype.sweep = function (ids, editSets, opts) {
		var self = this, LLM = this.LLM, model = this.model, plain = plainIds(ids);
		var T, n, W, first, vocab = this.config.vocab, i, k, subs = [], doneBy = [], merged, subOpts, outer;

		// Mistakes are found here, on the page, so that the message names the right edit set.
		try {
			LLM.checkOptions(opts, LLM.optionNames.sweep, 'sweep');
			opts = opts || {};
			T = model.checkIds(plain);
			if (!Array.isArray(editSets)) throw new Error('sweep: the edit sets must be an array, each entry one edit or a list of edits');
			model.checkEdits(opts.base, T);
			for (i = 0; i < editSets.length; i++) {
				try {
					model.checkEdits(editSets[i], T);
				} catch (err) {
					throw new Error('sweep: edit set ' + i + ': ' + textOf(err).replace(/^LLM: /, ''));
				}
			}
		} catch (err) {
			return rejected(mistake(textOf(err)));
		}

		n = editSets.length;
		W = Math.max(1, Math.min(this.workers.length || 1, n));
		first = this.turn;
		this.turn += W;
		subOpts = { at: opts.at, target: opts.target, loss: opts.loss, logits: opts.logits, base: LLM.copyEdits(opts.base) };
		merged = {
			kl: new Float32Array(n).fill(NaN),
			pTarget: new Float32Array(n).fill(NaN),
			top: new Int32Array(n).fill(-1),
			loss: (opts.loss !== false && T > 1) ? new Float32Array(n).fill(NaN) : null,
			logits: opts.logits ? new Float32Array(n * vocab).fill(NaN) : null
		};

		function total() {
			var s = 0, j;
			for (j = 0; j < doneBy.length; j++) s += doneBy[j];
			return s;
		}

		function onPart(which) {
			return function (done, count, part) {
				var size = part.kl.length, index = new Int32Array(size), j, g;
				for (j = 0; j < size; j++) {
					g = (part.from + j) * W + which;
					index[j] = g;
					merged.kl[g] = part.kl[j];
					merged.pTarget[g] = part.pTarget[j];
					merged.top[g] = part.top[j];
					if (merged.loss && part.loss) merged.loss[g] = part.loss[j];
				}
				doneBy[which] = done;
				if (opts.onProgress) callHook(opts.onProgress, total(), n, { index: index, kl: part.kl, pTarget: part.pTarget, top: part.top, loss: part.loss });
			};
		}

		for (k = 0; k < W; k++) {
			doneBy.push(0);
			subs.push(this.request('sweep', {
				ids: plain,
				editSets: editSets.filter(function (set, j) { return j % W === k; }).map(function (set) { return LLM.copyEdits(set); }),
				opts: subOpts
			}, { onProgress: onPart(k) }, first + k));
		}

		outer = Promise.all(subs).then(function (results) {
			var out = { n: n, done: 0, cancelled: false, at: results[0].at, target: results[0].target, base: results[0].base }, r, j, g, which;
			for (which = 0; which < results.length; which++) {
				r = results[which];
				out.done += r.done;
				if (r.cancelled) out.cancelled = true;
				for (j = 0; j < r.done; j++) {
					g = j * W + which;
					merged.kl[g] = r.kl[j];
					merged.pTarget[g] = r.pTarget[j];
					merged.top[g] = r.top[j];
					if (merged.loss && r.loss) merged.loss[g] = r.loss[j];
					if (merged.logits && r.logits) merged.logits.set(r.logits.subarray(j * vocab, (j + 1) * vocab), g * vocab);
				}
			}
			out.kl = merged.kl;
			out.pTarget = merged.pTarget;
			out.top = merged.top;
			out.loss = merged.loss;
			if (merged.logits) out.logits = merged.logits;
			return out;
		}, function (err) {
			subs.forEach(function (s) { s.cancel(); });
			throw err;
		});
		outer.cancel = function () {
			subs.forEach(function (s) { s.cancel(); });
		};
		return outer;
	};

	// ---------------------------------------------------------------- workers

	// Resolves with { worker } once worker.js has loaded the model, or { worker: null, error }.
	function startWorker(base, bin, tok) {
		return new Promise(function (resolve) {
			var worker = null, settled = false, timer;
			function giveUp(why) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (worker) worker.terminate();
				resolve({ worker: null, error: why });
			}
			if (typeof Worker === 'undefined') {
				giveUp('this browser has no Web Workers');
				return;
			}
			try {
				worker = new Worker(base + 'worker.js');
			} catch (err) {
				giveUp('worker.js could not be started: ' + textOf(err));
				return;
			}
			timer = setTimeout(function () { giveUp('worker.js did not answer in ' + (WORKER_WAIT_MS / 1000) + ' s'); }, WORKER_WAIT_MS);
			worker.onerror = function (event) {
				if (event && event.preventDefault) event.preventDefault();
				giveUp('worker.js failed: ' + (event && event.message ? event.message : 'it did not load'));
			};
			worker.onmessage = function (event) {
				var m = event.data;
				if (settled || !m || m.id !== 0) return;
				if (!m.ok) {
					giveUp('worker.js could not load the model: ' + m.error);
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve({ worker: worker });
			};
			// No transfer list: the worker gets copies, the page's model keeps its own.
			worker.postMessage({ id: 0, cmd: 'load', args: { bin: bin, tok: tok } });
		});
	}

	// Always resolves. With no worker at all the client stays in 'main' mode and says why in workerError.
	function startWorkers(client, bin, tok, count) {
		var starts = [], i;
		for (i = 0; i < count; i++) starts.push(startWorker(client.base, bin, tok));
		return Promise.all(starts).then(function (list) {
			list.forEach(function (r) {
				if (!r.worker) {
					if (!client.workerError) client.workerError = r.error;
					return;
				}
				client.workers.push(r.worker);
				r.worker.onmessage = function (e) { client.receive(e.data); };
				r.worker.onerror = function (e) {
					// A worker that breaks later: what was running is lost, later calls run on the page.
					if (e && e.preventDefault) e.preventDefault();
					client.workerError = 'worker.js failed: ' + (e && e.message ? e.message : 'unknown error');
					client.dropWorkers();
					client.failAll(problem('The language model stopped while it was working.', client.workerError));
				};
			});
			client.threads = client.workers.length;
			if (client.threads) client.mode = 'worker';
		});
	}

	function workerCount(opts) {
		var cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
		if (opts.worker === false) return 0;
		if (typeof opts.workers === 'number') return Math.max(0, Math.min(16, Math.floor(opts.workers)));
		return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
	}

	// ----------------------------------------------------------------- create

	function create(opts) {
		var base, loaded = 0, k, names = ['onProgress', 'workers', 'worker', 'base'];
		opts = opts || {};
		for (k in opts) {
			if (Object.prototype.hasOwnProperty.call(opts, k) && names.indexOf(k) < 0) {
				return rejected(mistake('LLMClient.create: unknown option "' + k + '" (known: ' + names.join(', ') + ')'));
			}
		}
		base = opts.base || HERE;
		if (!base) {
			return Promise.reject(problem('The language model could not be loaded.',
				'client.js cannot tell which folder it came from; pass { base: "<site>/misc/_llm/" }'));
		}
		if (base.charAt(base.length - 1) !== '/') base += '/';
		function onBytes(n) {
			loaded += n;
			callHook(opts.onProgress, Math.min(loaded, TOTAL_BYTES), TOTAL_BYTES);
		}
		return loadLLM(base).then(function (LLM) {
			return Promise.all(FILES.map(function (f) {
				return fetchBytes(base + f.path, opts.onProgress ? onBytes : null);
			})).then(function (bufs) {
				var model, client, count = workerCount(opts);
				try {
					model = LLM.load(bufs[0], bufs[1]);
				} catch (err) {
					throw problem('The language model could not be loaded.', textOf(err));
				}
				client = new Client(LLM, model, base);
				if (!count) return client;
				return startWorkers(client, bufs[0], bufs[1], count).then(function () { return client; });
			});
		});
	}

	window.LLMClient = {
		create: create,
		base: HERE,
		bytes: TOTAL_BYTES
	};
})();
