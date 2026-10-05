/*
 * TinyNet worker: one modular-addition trainer (TinyNet.grok) served over messages,
 * so training never blocks the page. client.js is the promise API over this file;
 * README.md documents the messages.
 *
 *   in:   { id, cmd, args }
 *   out:  { id, type: 'progress', data }      zero or more, for train, unlearn and slice
 *         { id, type: 'result', data }        once
 *         { id, type: 'error', message }      once, instead of the result
 *         { type: 'ready', version }          once, when the scripts have loaded
 *
 * Long jobs (train, unlearn, slice) run in slices of about 25 ms and yield to the
 * message queue in between, which is how "stop" and the quick queries get through.
 */
/* global TinyNet, importScripts, self, MessageChannel */
'use strict';

importScripts('tinynet.js');

var trainer = null;
var job = null; // { id, kind, tick(deadline) -> true while there is more to do, stop() }
var SLICE_MS = 25;
var channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;

function now() {
	return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function post(id, type, data, transfer) {
	var msg = { id: id, type: type, data: data };
	if (transfer && transfer.length) self.postMessage(msg, transfer);
	else self.postMessage(msg);
}

function postError(id, err) {
	self.postMessage({ id: id, type: 'error', message: err && err.message ? String(err.message) : String(err) });
}

function need() {
	if (!trainer) throw new Error('TinyNet worker: call init first');
	return trainer;
}

// The buffers of the typed arrays directly inside an object, for a zero-copy post.
function buffersOf(obj) {
	var list = [], k, v;
	if (!obj || typeof obj !== 'object') return list;
	if (obj.buffer instanceof ArrayBuffer) return [obj.buffer];
	for (k in obj) {
		v = obj[k];
		if (v && v.buffer instanceof ArrayBuffer && list.indexOf(v.buffer) < 0) list.push(v.buffer);
	}
	return list;
}

// One slice of the running job. tick() answers true (more to do, come back at once), a number
// (come back after that many milliseconds: a paced run that is ahead of its rate) or false (done).
// The token keeps a wake-up meant for an earlier job from driving a later one.
function pump(token) {
	var more;
	if (!job || job.token !== token) return;
	try {
		more = job.tick(now() + SLICE_MS);
	} catch (err) {
		more = false;
		postError(job.id, err);
	}
	if (more === false) job = null;
	else later(token, typeof more === 'number' ? more : 0);
}

// Comes back through the MessageChannel, which has no minimum delay. Every 100 ms it takes a timer
// instead, so that an engine which serves a port's own messages first still gets to "stop".
var lastTimer = 0;

function later(token, ms) {
	var t = now();
	if (ms > 0 || !channel || t - lastTimer > 100) {
		lastTimer = t;
		setTimeout(function () { pump(token); }, ms);
	} else {
		channel.port2.postMessage(token);
	}
}

if (channel) {
	channel.port1.onmessage = function (e) {
		pump(e.data);
	};
}

var tokens = 0;

// make(id, args) builds the job. The busy check comes first: building an unlearn job already
// touches the trainer.
function startJob(make, id, args) {
	if (job) throw new Error('TinyNet worker: busy with ' + job.kind + '; stop() it first');
	job = make(id, args);
	job.token = ++tokens;
	later(job.token, 0);
}

// Ends the running job now; its promise resolves with stopped: true.
function cancelJob() {
	var j = job;
	if (!j) return false;
	job = null;
	try {
		j.stop();
	} catch (err) {
		postError(j.id, err);
	}
	return true;
}

function trainJob(id, a) {
	var t = need(), epochs = a.epochs === undefined || a.epochs === null ? 1000 : Math.max(0, a.epochs | 0), every = Math.max(1, (a.every | 0) || 10),
		until = a.until || null, include = a.include || null, rate = a.rate > 0 ? +a.rate : 0, ran = 0, t0 = now(), reported = -1;

	function timing(m) {
		var ms = now() - t0;
		m.ran = ran;
		m.ms = ms;
		m.epochsPerSec = ms > 0 ? ran / ms * 1000 : 0;
		return m;
	}

	// One progress message: the metrics now, plus whatever `include` asks for.
	function report() {
		var m = timing(t.metrics()), transfer = [], tb, sp;
		if (include) {
			if (include.table) {
				tb = t.table();
				m.table = tb;
				transfer.push(tb.pred.buffer, tb.isTrain.buffer, tb.prob.buffer);
			}
			if (include.spectrum) {
				sp = t.spectrum({ of: typeof include.spectrum === 'string' ? include.spectrum : 'a' });
				m.spectrum = sp;
				transfer = transfer.concat(buffersOf(sp));
			}
			if (include.norms) m.norms = t.norms();
		}
		reported = t.epoch;
		post(id, 'progress', m, transfer);
	}

	function reached(m) {
		var any = false;
		if (!until) return false;
		if (until.testAcc !== undefined) { any = true; if (!(m.testAcc >= until.testAcc)) return false; }
		if (until.trainAcc !== undefined) { any = true; if (!(m.trainAcc >= until.trainAcc)) return false; }
		if (until.testLoss !== undefined) { any = true; if (!(m.testLoss <= until.testLoss)) return false; }
		if (until.trainLoss !== undefined) { any = true; if (!(m.trainLoss <= until.trainLoss)) return false; }
		return any;
	}

	// The last progress message always describes the state the job ends in.
	function finish(reason) {
		var m;
		if (reported !== t.epoch) report();
		m = timing(t.metrics());
		m.stopped = reason === 'stopped';
		m.reason = reason;
		post(id, 'result', m);
	}

	return {
		id: id,
		kind: 'train',
		tick: function (deadline) {
			var ahead;
			while (ran < epochs) {
				if (rate) {
					// A paced run: epoch number `ran` is not due before ran / rate seconds have passed.
					ahead = t0 + ran / rate * 1000 - now();
					if (ahead > 1) return ahead;
				}
				t.run(1);
				ran++;
				if (t.epoch % every === 0) {
					report();
					if (reached(t.metrics())) {
						finish('until');
						return false;
					}
					if (ran < epochs) return true; // yield after every report, so "stop" is never far away
				} else if (now() >= deadline) {
					return true;
				}
			}
			finish('done');
			return false;
		},
		stop: function () {
			finish('stopped');
		}
	};
}

function unlearnJob(id, a) {
	var t = need(), uj = t.unlearnJob(a), sent = 1; // curve[0] is the state before the first step

	function flush() {
		var m;
		if (uj.curve.length > sent) {
			sent = uj.curve.length;
			m = uj.curve[sent - 1];
			post(id, 'progress', { step: m.step, steps: uj.steps, forget: m.forget, retain: m.retain, test: m.test });
			return true;
		}
		return false;
	}

	return {
		id: id,
		kind: 'unlearn',
		tick: function (deadline) {
			var told;
			while (!uj.done) {
				uj.step(1);
				told = flush();
				if (uj.done) break;
				if (told || now() >= deadline) return true;
			}
			flush();
			post(id, 'result', uj.result);
			return false;
		},
		stop: function () {
			uj.stop();
			flush();
			post(id, 'result', uj.result);
		}
	};
}

function sliceJob(id, a) {
	var t = need(), sj = t.sliceJob(a);

	function finish() {
		var r = sj.result, transfer = [r.loss.buffer, r.acc.buffer, r.axes.x.buffer, r.axes.y.buffer];
		if (r.lossTest) transfer.push(r.lossTest.buffer, r.accTest.buffer);
		post(id, 'result', r, transfer);
	}

	return {
		id: id,
		kind: 'slice',
		tick: function (deadline) {
			while (!sj.done) {
				sj.step(1);
				if (!sj.done && now() >= deadline) {
					post(id, 'progress', { done: sj.at, total: sj.total });
					return true;
				}
			}
			finish();
			return false;
		},
		stop: function () {
			sj.stop();
			finish();
		}
	};
}

var commands = {
	ping: function () {
		return { version: TinyNet.version, ready: !!trainer, busy: job ? job.kind : null };
	},
	init: function (a) {
		var m;
		cancelJob();
		if (a && a.snapshot) trainer = TinyNet.restore(a.snapshot);
		else trainer = TinyNet.grok(a || {});
		m = trainer.metrics();
		m.cfg = trainer.cfg;
		m.nTrain = trainer.nTrain;
		m.nTest = trainer.nTest;
		m.params = 3 * trainer.p * trainer.hidden;
		return m;
	},
	metrics: function () {
		return need().metrics();
	},
	weights: function () {
		var w = need().weights();
		w.epoch = trainer.epoch;
		return w;
	},
	load: function (a) {
		need();
		cancelJob();
		return trainer.load(a.weights, { epoch: a.epoch });
	},
	reset: function () {
		need();
		cancelJob();
		return trainer.reset();
	},
	// Allowed in the middle of a run: the new settings apply from the next epoch.
	set: function (a) {
		return need().set(a);
	},
	table: function () {
		return need().table();
	},
	spectrum: function (a) {
		return need().spectrum(a || {});
	},
	norms: function () {
		return need().norms();
	},
	merge: function (a) {
		var r = need().merge(a.other, a),
			transfer = [r.weights.W1a.buffer, r.weights.W1b.buffer, r.weights.W2.buffer, r.other.W1a.buffer, r.other.W1b.buffer, r.other.W2.buffer, r.match.buffer, r.sign.buffer];
		if (r.similarity) transfer.push(r.similarity.buffer);
		return { value: r, transfer: transfer };
	},
	influence: function (a) {
		return need().influence(a.query, a);
	},
	lossAt: function (a) {
		return need().lossAt(a.xy ? { xy: a.xy } : a.weights, a.which);
	},
	gradAt: function (a) {
		var r = need().gradAt(a.xy ? { xy: a.xy } : a.weights, a.which);
		return { value: r, transfer: buffersOf(r.grad) };
	},
	evalOn: function (a) {
		return need().evalOn(a.pairs, a.weights);
	},
	planeWeights: function (a) {
		return need().planeWeights(a.x, a.y);
	}
};

self.onmessage = function (e) {
	var m = e.data, id, a, r;
	if (!m || typeof m.cmd !== 'string') return;
	id = m.id;
	a = m.args || {};
	try {
		if (m.cmd === 'stop') {
			post(id, 'result', { stopped: cancelJob() });
		} else if (m.cmd === 'train') {
			startJob(trainJob, id, a);
		} else if (m.cmd === 'unlearn') {
			startJob(unlearnJob, id, a);
		} else if (m.cmd === 'slice') {
			startJob(sliceJob, id, a);
		} else if (commands[m.cmd]) {
			r = commands[m.cmd](a);
			if (r && r.transfer && r.value) post(id, 'result', r.value, r.transfer);
			else post(id, 'result', r, buffersOf(r));
		} else {
			throw new Error('TinyNet worker: unknown command "' + m.cmd + '"');
		}
	} catch (err) {
		postError(id, err);
	}
};

self.postMessage({ type: 'ready', version: TinyNet.version });
