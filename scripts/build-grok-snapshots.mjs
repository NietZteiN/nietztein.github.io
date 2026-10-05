// Builds misc/_tinynet/snapshots.js: four trained states of the default
// modular-addition network of misc/_tinynet/tinynet.js, for toy thumbnails and
// for a "load a trained network" button.
//
// Zero dependencies. Run with:
//   node scripts/build-grok-snapshots.mjs           train and write the file (about 30 s)
//   node scripts/build-grok-snapshots.mjs --check   train, compare with the file, exit 1 if it differs
//
// The output has no dates and no machine-dependent numbers: the trainer uses
// only + - * / and sqrt on IEEE doubles, so the same tinynet.js gives the same
// file byte for byte. misc/_tinynet/test.js retrains the four runs and fails
// when the file no longer matches, which is the cue to run this again.
//
// What is stored (window.TINYNET_SNAPSHOTS):
//   grokked    the default run (p 41, hidden 128, relu, 60%, lr 0.01, wd 1, seed 1) after 1500 epochs,
//              with its metric curve every 10 epochs
//   memorised  the same run at epoch 100: every training pair right, no test pair right
//   second     seed 2 on the train/test split of seed 1, 1500 epochs, for merging
//   noDecay    seed 1 with weight decay 0, 1500 epochs: memorised for good
//   slices     two 25 by 25 loss-landscape slices of grokked (train and test loss): around it in two
//              random directions, and the plane through grokked, second and second aligned to grokked

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TinyNet = require(path.join(root, 'misc', '_tinynet', 'tinynet.js'));
const outFile = path.join(root, 'misc', '_tinynet', 'snapshots.js');

const EPOCHS = 1500;
const MEMO_EPOCH = 100;
const EVERY = 10;
const SLICE_N = 25;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const unknown = args.filter((a) => a !== '--check');
if (unknown.length || args.includes('--help')) {
	console.error('Usage: node scripts/build-grok-snapshots.mjs [--check]');
	process.exit(unknown.length ? 2 : 0);
}

// Six significant digits: enough for a chart, and short in the file.
const r6 = (x) => +x.toPrecision(6);

function roundMetrics(m) {
	return { epoch: m.epoch, trainLoss: r6(m.trainLoss), trainAcc: r6(m.trainAcc), testLoss: r6(m.testLoss), testAcc: r6(m.testAcc) };
}

function state(trainer, about) {
	const norms = trainer.norms();
	return {
		about,
		cfg: trainer.cfg,
		epoch: trainer.epoch,
		metrics: roundMetrics(trainer.metrics()),
		purity: +trainer.spectrum().mean.toPrecision(4),
		norm: +norms.total.toPrecision(4),
		weights: TinyNet.encodeWeights(trainer.weights()),
	};
}

// Trains for EPOCHS epochs, recording the metrics every EVERY epochs. at[epoch] is called at that epoch.
function run(cfg, at = {}) {
	const started = Date.now();
	const trainer = TinyNet.grok(cfg);
	const curve = { every: EVERY, trainLoss: [], trainAcc: [], testLoss: [], testAcc: [] };
	const marks = { memorised: -1, half: -1, grokked: -1 };
	const push = (m) => {
		curve.trainLoss.push(r6(m.trainLoss));
		curve.trainAcc.push(r6(m.trainAcc));
		curve.testLoss.push(r6(m.testLoss));
		curve.testAcc.push(r6(m.testAcc));
		if (marks.memorised < 0 && m.trainAcc >= 1) marks.memorised = m.epoch;
		if (marks.half < 0 && m.testAcc >= 0.5) marks.half = m.epoch;
		if (marks.grokked < 0 && m.testAcc >= 0.99) marks.grokked = m.epoch;
	};
	push(trainer.metrics());
	for (let e = EVERY; e <= EPOCHS; e += EVERY) {
		const m = trainer.step(EVERY);
		push(m);
		if (at[e]) at[e](trainer);
	}
	const seconds = (Date.now() - started) / 1000;
	return { trainer, curve, marks, seconds };
}

function build() {
	const snaps = {};
	let memorised = null;

	const a = run({}, {
		[MEMO_EPOCH]: (trainer) => {
			memorised = state(trainer, 'The default run at epoch ' + MEMO_EPOCH + ': every training pair right, the rule not learned yet.');
		},
	});
	const grokked = state(a.trainer, 'The default run after ' + EPOCHS + ' epochs: grokked.');
	grokked.marks = a.marks;
	grokked.curve = a.curve;
	console.error(`grokked    ${a.seconds.toFixed(1)} s  ${JSON.stringify(grokked.metrics)}  marks ${JSON.stringify(a.marks)}  purity ${grokked.purity}`);
	console.error(`memorised  ${JSON.stringify(memorised.metrics)}  purity ${memorised.purity}`);

	const b = run({ seed: 2, splitSeed: 1 });
	const second = state(b.trainer, 'Another initialisation (seed 2) trained on the same pairs as the default run, ' + EPOCHS + ' epochs: for merging.');
	second.marks = b.marks;
	second.curve = b.curve;
	console.error(`second     ${b.seconds.toFixed(1)} s  ${JSON.stringify(second.metrics)}  marks ${JSON.stringify(b.marks)}  purity ${second.purity}`);

	const z = run({ wd: 0 });
	const noDecay = state(z.trainer, 'The default run with weight decay 0, ' + EPOCHS + ' epochs: memorised, never generalised.');
	noDecay.marks = z.marks;
	noDecay.curve = z.curve;
	console.error(`noDecay    ${z.seconds.toFixed(1)} s  ${JSON.stringify(noDecay.metrics)}  marks ${JSON.stringify(z.marks)}  purity ${noDecay.purity}`);

	// Two ready-made loss-landscape slices, so a page has a surface to draw before its worker has computed one.
	const started = Date.now();
	const around = a.trainer.slice({ n: SLICE_N, seed: 1, which: 'both' });
	const aligned = a.trainer.merge(b.trainer.weights(), { align: true, alpha: 1 }).other;
	const basins = a.trainer.slice({ n: SLICE_N, toward: b.trainer.weights(), toward2: aligned, which: 'both', center: [0.5, 0.5] });
	console.error(`slices     ${((Date.now() - started) / 1000).toFixed(1) + ' s'}  basins: second at (1, 0), second aligned at (${basins.points.other2.map((v) => v.toFixed(4)).join(', ')})`);

	snaps.version = TinyNet.version;
	snaps.epochs = EPOCHS;
	snaps.grokked = grokked;
	snaps.memorised = memorised;
	snaps.second = second;
	snaps.noDecay = noDecay;
	snaps.slices = {
		around: sliceState(around, 'grokked: two random directions, each matrix rescaled to the norm of the matching weight matrix (seed 1).', { seed: 1 }),
		basins: sliceState(basins, 'The plane through grokked at (0, 0), second at (1, 0) and second with its hidden units aligned to grokked at points.other2; distances are true to scale.', {}),
	};
	return snaps;
}

// Four significant digits of the Float32 values slice() returns.
const r4 = (x) => +x.toPrecision(4);

function sliceState(s, about, extra) {
	return {
		about,
		of: 'grokked',
		n: s.n,
		span: s.span,
		center: s.center,
		...extra,
		points: s.points,
		// The grid coordinates exactly as slice() used them (Float32 values), so a point can be recomputed.
		x: Array.from(s.axes.x),
		y: Array.from(s.axes.y),
		train: Array.from(s.loss, r4),
		test: Array.from(s.lossTest, r4),
	};
}

function render(snaps) {
	const lines = [];
	lines.push('/*');
	lines.push(' * Trained states of the default TinyNet.grok network. GENERATED by scripts/build-grok-snapshots.mjs');
	lines.push(' * from misc/_tinynet/tinynet.js ' + snaps.version + '; do not edit by hand. README.md describes the fields.');
	lines.push(' *');
	lines.push(' *   TinyNet.restore(TINYNET_SNAPSHOTS.grokked)            a trainer in that state');
	lines.push(' *   TinyNet.decodeWeights(snapshot.weights, 41, 128)      just the weights');
	lines.push(' */');
	lines.push('(function () {');
	lines.push("\t'use strict';");
	lines.push('\tvar SNAPSHOTS = {');
	lines.push('\t\tversion: ' + JSON.stringify(snaps.version) + ',');
	lines.push('\t\tepochs: ' + snaps.epochs + ',');
	const names = ['grokked', 'memorised', 'second', 'noDecay'];
	names.forEach((name, i) => {
		const s = snaps[name];
		lines.push('\t\t' + name + ': {');
		lines.push('\t\t\tabout: ' + JSON.stringify(s.about) + ',');
		lines.push('\t\t\tcfg: ' + JSON.stringify(s.cfg) + ',');
		lines.push('\t\t\tepoch: ' + s.epoch + ',');
		lines.push('\t\t\tmetrics: ' + JSON.stringify(s.metrics) + ',');
		lines.push('\t\t\tpurity: ' + s.purity + ',');
		lines.push('\t\t\tnorm: ' + s.norm + ',');
		if (s.marks) lines.push('\t\t\tmarks: ' + JSON.stringify(s.marks) + ',');
		if (s.curve) {
			lines.push('\t\t\tcurve: {');
			lines.push('\t\t\t\tevery: ' + s.curve.every + ',');
			lines.push('\t\t\t\ttrainLoss: ' + JSON.stringify(s.curve.trainLoss) + ',');
			lines.push('\t\t\t\ttrainAcc: ' + JSON.stringify(s.curve.trainAcc) + ',');
			lines.push('\t\t\t\ttestLoss: ' + JSON.stringify(s.curve.testLoss) + ',');
			lines.push('\t\t\t\ttestAcc: ' + JSON.stringify(s.curve.testAcc));
			lines.push('\t\t\t},');
		}
		lines.push('\t\t\tweights: ' + JSON.stringify(s.weights));
		lines.push('\t\t},');
	});
	lines.push('\t\tslices: {');
	const sliceNames = ['around', 'basins'];
	sliceNames.forEach((name, i) => {
		const s = snaps.slices[name];
		lines.push('\t\t\t' + name + ': {');
		for (const key of Object.keys(s)) {
			lines.push('\t\t\t\t' + key + ': ' + JSON.stringify(s[key]) + (key === 'test' ? '' : ','));
		}
		lines.push('\t\t\t}' + (i < sliceNames.length - 1 ? ',' : ''));
	});
	lines.push('\t\t}');
	lines.push('\t};');
	lines.push("\tif (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = SNAPSHOTS;");
	lines.push("\tif (typeof window !== 'undefined') window.TINYNET_SNAPSHOTS = SNAPSHOTS;");
	lines.push("\telse if (typeof self !== 'undefined') self.TINYNET_SNAPSHOTS = SNAPSHOTS;");
	lines.push('})();');
	return lines.join('\n') + '\n';
}

const text = render(build());
const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);

if (checkOnly) {
	const have = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : null;
	if (have === text) {
		console.log(`ok: misc/_tinynet/snapshots.js is up to date (${kb} KB)`);
	} else {
		console.log(have === null ? 'FAIL: misc/_tinynet/snapshots.js does not exist' : 'FAIL: misc/_tinynet/snapshots.js differs from a fresh build; run node scripts/build-grok-snapshots.mjs');
		process.exit(1);
	}
} else {
	fs.writeFileSync(outFile, text);
	console.log(`wrote misc/_tinynet/snapshots.js (${kb} KB)`);
}
