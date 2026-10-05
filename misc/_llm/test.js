// node misc/_llm/test.js
//
// Tests of the model kit that need no browser. Prints one PASS or FAIL line per
// check and exits with code 1 if anything failed. The golden sample is the text
// that upstream's own readme says the C program prints; everything else checks
// that what the kit hands out is what the model really computed.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LLM = require('./llm.js');

const HERE = __dirname;
let failures = 0;
let count = 0;

function report(ok, name, detail) {
	count++;
	if (!ok) failures++;
	console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}

// Runs fn; it returns a detail string (or nothing) and throws to fail.
function test(name, fn) {
	try {
		report(true, name, fn() || '');
	} catch (err) {
		report(false, name, String(err && err.message ? err.message : err));
	}
}

async function testAsync(name, fn) {
	try {
		report(true, name, (await fn()) || '');
	} catch (err) {
		report(false, name, String(err && err.message ? err.message : err));
	}
}

function assert(cond, message) {
	if (!cond) throw new Error(message || 'assertion failed');
}

function equal(a, b, what) {
	if (a !== b) throw new Error((what || 'value') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
}

function throws(fn, pattern, what) {
	let message = null;
	try { fn(); } catch (err) { message = String(err.message); }
	if (message === null) throw new Error((what || 'call') + ' did not throw');
	if (pattern && !pattern.test(message)) throw new Error((what || 'call') + ' threw "' + message + '", expected ' + pattern);
}

function maxDiff(a, b) {
	if (a.length !== b.length) throw new Error('lengths differ: ' + a.length + ' and ' + b.length);
	let d = 0;
	for (let i = 0; i < a.length; i++) {
		const e = Math.abs(a[i] - b[i]);
		if (!(e <= d)) d = e;           // also catches NaN
	}
	return d;
}

function argmax(a) {
	let best = 0;
	for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
	return best;
}

function logSoftmax(a) {
	let max = -Infinity, sum = 0;
	for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
	for (let i = 0; i < a.length; i++) sum += Math.exp(a[i] - max);
	const lse = max + Math.log(sum);
	return Array.from(a, (v) => v - lse);
}

function pearson(a, b) {
	let ma = 0, mb = 0;
	for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
	ma /= a.length;
	mb /= a.length;
	let sab = 0, saa = 0, sbb = 0;
	for (let i = 0; i < a.length; i++) {
		sab += (a[i] - ma) * (b[i] - mb);
		saa += (a[i] - ma) * (a[i] - ma);
		sbb += (b[i] - mb) * (b[i] - mb);
	}
	return sab / Math.sqrt(saa * sbb);
}

function sha256(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

// ------------------------------------------------------------------ fixtures

const FILES = {
	bin: { name: 'stories260K.bin', bytes: 1056540, sha256: 'b0a507e7ad0f626624f17112325e66691f9076d622e1d3274d103d00299f2696' },
	tok: { name: 'tok512.bin', bytes: 6227, sha256: '037cb335abb25d1fa9e8ecae30ed2a3a8ace9302862ebcdc05d51a6bbb10c312' }
};

// What `./run stories260K/stories260K.bin -z stories260K/tok512.bin -t 0.0` prints, from
// https://huggingface.co/karpathy/tinyllamas/blob/main/stories260K/readme.md : 256 tokens,
// always taking the most likely one, starting from the start token alone.
const GOLDEN = [
	'Once upon a time, there was a little girl named Lily. She loved to play outside in the park. One day, she saw a big, red ball. She wanted to play with it, but it was too high.',
	'Lily\'s mom said, "Lily, let\'s go to the park." Lily was sad and didn\'t know what to do. She said, "I want to play with your ball, but I can\'t find it."',
	'Lily was sad and didn\'t know what to do. She said, "I\'m sorry, Lily. I didn\'t know what to do."',
	'Lily didn\'t want to help her mom, so she said, "I\'m sorry, mom. I didn\'t know what to do." Her mom said, "Don\'t worry, Lily. We can help you.'
].join('\n');

const SENTENCES = [
	'Once upon a time, there was a little girl named Lily.',
	'She loved to play outside in the park.',
	'The quick brown fox jumps over the lazy dog.',
	'"Can we go home now?" asked Tom. "Not yet," said his mom.',
	'Two lines.\nAnd a second one, with  two spaces and a tab\there.',
	'Numbers: 3 apples, 14 pears and 1,000 ants!',
	' a leading space, and a trailing one ',
	'It\'s Lily\'s ball; isn\'t it?',
	'x'
];

let binBuf = null, tokBuf = null, model = null;

test('the two weight files are on disk with the recorded size and SHA-256', () => {
	binBuf = fs.readFileSync(path.join(HERE, 'weights', FILES.bin.name));
	tokBuf = fs.readFileSync(path.join(HERE, 'weights', FILES.tok.name));
	equal(binBuf.length, FILES.bin.bytes, FILES.bin.name + ' bytes');
	equal(tokBuf.length, FILES.tok.bytes, FILES.tok.name + ' bytes');
	equal(sha256(binBuf), FILES.bin.sha256, FILES.bin.name + ' sha256');
	equal(sha256(tokBuf), FILES.tok.sha256, FILES.tok.name + ' sha256');
	return (binBuf.length + tokBuf.length) + ' bytes in all';
});

test('LICENSES.md records the same sizes and hashes', () => {
	const text = fs.readFileSync(path.join(HERE, 'LICENSES.md'), 'utf8');
	for (const f of [FILES.bin, FILES.tok]) {
		assert(text.includes(f.sha256), 'LICENSES.md does not contain the SHA-256 of ' + f.name);
		assert(text.includes(f.bytes.toLocaleString('en-US')) || text.includes(String(f.bytes)), 'LICENSES.md does not contain the size of ' + f.name);
	}
	assert(/\bMIT\b/.test(text), 'LICENSES.md does not name the licence');
});

test('LLM.load reads the checkpoint: 64 wide, 5 layers, 8 heads over 4 key/value heads', () => {
	model = LLM.load(binBuf, tokBuf);
	const c = model.config;
	assert(JSON.stringify(c) === JSON.stringify({ dim: 64, hidden: 172, layers: 5, heads: 8, kvHeads: 4, vocab: 512, seqLen: 512 }), 'config is ' + JSON.stringify(c));
	equal(model.params, 260032, 'parameter count');
	equal(model.tied, true, 'output matrix shared with the embedding');
	assert(model.weights.wcls === model.weights.tokEmb, 'wcls should be the embedding table itself');
	return model.params + ' parameters';
});

if (!model) {
	console.log('\nThe model did not load; the remaining tests cannot run.');
	process.exit(1);
}

const c = model.config;

test('LLM.load also takes ArrayBuffers and unaligned views, and refuses damaged files', () => {
	const ab = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
	const tb = tokBuf.buffer.slice(tokBuf.byteOffset, tokBuf.byteOffset + tokBuf.byteLength);
	const m1 = LLM.load(ab, tb);
	equal(m1.decode(m1.generate([1], { maxNew: 12 })), 'Once upon a time, there was a little girl', 'from ArrayBuffers');
	const shifted = new Uint8Array(binBuf.length + 1);
	shifted.set(binBuf, 1);
	const m2 = LLM.load(shifted.subarray(1), tb);
	equal(maxDiff(m2.weights.w1, model.weights.w1), 0, 'weights read from an odd byte offset');
	throws(() => LLM.load(binBuf.subarray(0, 5000), tokBuf), /bytes/, 'a truncated checkpoint');
	throws(() => LLM.load(binBuf, tokBuf.subarray(0, 100)), /tokenizer/, 'a truncated tokenizer');
	throws(() => LLM.load('nope', tokBuf), /ArrayBuffer/, 'a string instead of bytes');
});

test('the layout is right: the rotation tables the file still carries equal the computed ones', () => {
	const w = model.weights;
	equal(w.ropeCosFile.length, c.seqLen * model.headSize / 2, 'table size');
	const dc = maxDiff(w.ropeCosFile, model.ropeCos);
	const ds = maxDiff(w.ropeSinFile, model.ropeSin);
	assert(dc < 1e-5 && ds < 1e-5, 'cos differs by ' + dc + ', sin by ' + ds);
	return 'largest difference ' + Math.max(dc, ds).toExponential(1);
});

// ------------------------------------------------------------------ tokenizer

test('the vocabulary: 512 distinct strings, 3 specials, 256 bytes, 253 learned pieces', () => {
	const v = model.vocab;
	equal(v.length, 512, 'vocabulary size');
	equal(new Set(v).size, 512, 'distinct strings');
	equal(v[0], '<unk>');
	equal(v[1], '<s>');
	equal(v[2], '</s>');
	equal(v[3], '<0x00>');
	equal(v[13], '<0x0A>');
	equal(v[258], '<0xFF>');
	equal(v[259], ' t');
	equal(v.indexOf(' Lily'), 317, 'id of " Lily"');
	equal(new Set(model.tokenizer.raw).size, 512, 'distinct stored pieces');
	equal(LLM.BOS, 1);
	const standalone = LLM.tokenizer(tokBuf, 512);
	equal(standalone.decode(standalone.encode('a little dog')), 'a little dog', 'the tokenizer alone');
});

test('encode / decode round-trips on ordinary sentences', () => {
	let tokens = 0;
	for (const s of SENTENCES.concat([GOLDEN, ''])) {
		const ids = model.encode(s);
		equal(ids[0], 1, 'first id of ' + JSON.stringify(s));
		equal(model.decode(ids), s, 'round trip');
		assert(ids.every((id) => Number.isInteger(id) && id >= 0 && id < 512), 'ids out of range');
		tokens += ids.length;
	}
	equal(JSON.stringify(model.encode('')), '[1]', 'the empty text');
	const lily = model.encode('Once upon a time, there was a little girl named Lily.').map((id) => model.vocab[id]);
	equal(lily.join('|'), '<s>| Once| upon| a| time|,| there| was| a| little| g|ir|l| named| Lily|.', 'pieces');
	return SENTENCES.length + 2 + ' texts, ' + tokens + ' tokens';
});

test('encode options: no start token leaves the leading space; eos appends id 2', () => {
	const ids = model.encode('the park', { bos: false });
	assert(ids[0] !== 1, 'bos: false still put a start token');
	equal(model.decode(ids), ' the park', 'decode without a start token keeps the space encode() added');
	const withEos = model.encode('the park', { eos: true });
	equal(withEos[withEos.length - 1], 2, 'last id with eos');
	equal(model.decode(withEos), 'the park', 'the specials give no text');
	equal(model.decode([317]), ' Lily', 'one id decodes to its piece');
	equal(model.decode(317), ' Lily', 'a bare id');
	throws(() => model.decode([999]), /vocabulary/, 'an id outside the vocabulary');
});

test('characters without a piece become byte tokens and come back whole', () => {
	const s = 'A na' + String.fromCharCode(0xEF) + 've caf' + String.fromCharCode(0xE9) + ' ' + String.fromCodePoint(0x1F600) + ' ok';
	const ids = model.encode(s);
	equal(model.decode(ids), s, 'round trip');
	const iDots = ids.indexOf(3 + 0xC3);
	assert(iDots > 0 && ids[iDots + 1] === 3 + 0xAF, 'the i with two dots should be the bytes C3 AF');
	equal(model.vocab[ids[iDots]], '<0xC3>');
	assert(ids.indexOf(model.vocab.indexOf(String.fromCharCode(0xE9))) > 0, 'the e with an accent has a piece of its own');
	const nl = model.encode('a\nb');
	assert(nl.indexOf(13) > 0, 'a line break is the byte token 13');
	// a stream of ids gives each character once its last byte has arrived
	const d = model.tokenizer.decoder();
	const parts = ids.map((id) => d.push(id));
	equal(parts.join('') + d.end(), s, 'streamed text');
	equal(parts[iDots], '', 'half a character gives no text yet');
	equal(model.decode([3 + 0xC3]), String.fromCharCode(0xFFFD), 'a lone lead byte');
});

test('encode agrees with a plain re-implementation of run.c\'s encode()', () => {
	// read tok512.bin again, independently of llm.js
	const pieces = [], scores = [];
	let off = 4;
	for (let i = 0; i < 512; i++) {
		scores.push(tokBuf.readFloatLE(off));
		const len = tokBuf.readInt32LE(off + 4);
		pieces.push(tokBuf.subarray(off + 8, off + 8 + len).toString('latin1'));
		off += 8 + len;
	}
	equal(off, tokBuf.length, 'bytes consumed');
	const lookup = new Map();
	pieces.forEach((p, i) => { if (!lookup.has(p)) lookup.set(p, i); });
	function reference(text) {
		const bytes = Buffer.from(text, 'utf8');
		const toks = [1];
		if (bytes.length) toks.push(lookup.get(' '));
		for (let i = 0; i < bytes.length;) {
			let j = i + 1;
			while (j < bytes.length && (bytes[j] & 0xC0) === 0x80 && j - i < 4) j++;
			const s = bytes.subarray(i, j).toString('latin1');
			if (lookup.has(s)) toks.push(lookup.get(s));
			else for (const b of bytes.subarray(i, j)) toks.push(b + 3);
			i = j;
		}
		for (;;) {
			let best = -1e10, bestId = -1, bestAt = -1;
			for (let k = 0; k < toks.length - 1; k++) {
				const id = lookup.get(pieces[toks[k]] + pieces[toks[k + 1]]);
				if (id !== undefined && scores[id] > best) { best = scores[id]; bestId = id; bestAt = k; }
			}
			if (bestAt < 0) break;
			toks.splice(bestAt, 2, bestId);
		}
		return toks;
	}
	const texts = SENTENCES.concat([GOLDEN, 'caf' + String.fromCharCode(0xE9) + ' ' + String.fromCodePoint(0x1F600), 'aaaaaaaaaa', 'the the the', '']);
	let n = 0;
	for (const s of texts) {
		equal(JSON.stringify(model.encode(s)), JSON.stringify(reference(s)), 'ids of ' + JSON.stringify(s.slice(0, 30)));
		n += model.encode(s).length;
	}
	return texts.length + ' texts, ' + n + ' tokens';
});

// --------------------------------------------------------------- the golden

let goldenIds = null;

test('golden: greedy from the start token gives the text in upstream\'s readme, all 256 tokens', () => {
	equal(GOLDEN.length, 565, 'length of the expected text');
	const pieces = [];
	const positions = [];
	goldenIds = model.generate([1], { maxNew: 256, temperature: 0, onToken: (id, text, pos) => { pieces.push(text); positions.push(pos); } });
	equal(goldenIds.length, 257, 'ids returned');
	equal(goldenIds.reason, 'length', 'why it stopped');
	equal(model.decode(goldenIds), GOLDEN, 'the text');
	equal(pieces.join(''), GOLDEN, 'the text handed to onToken');
	equal(positions.join(','), Array.from({ length: 256 }, (_, i) => i + 1).join(','), 'positions handed to onToken');
	return JSON.stringify(GOLDEN.slice(0, 52)) + '...';
});

test('golden: left alone, the greedy story ends itself after 345 tokens', () => {
	const ids = model.generate([1]);
	equal(ids.reason, 'bos', 'why it stopped');
	equal(ids.length, 346, 'ids');
	assert(model.decode(ids).startsWith(GOLDEN), 'the longer story should start with the golden text');
});

test('golden: with run.c\'s own sampler on these logits, upstream\'s sampled text too (-t 1.0 -p 0.9 -s 133742)', () => {
	// The same readme prints a second sample, drawn at temperature 1 with nucleus sampling. A draw
	// depends on every probability, not only on the largest, so this checks the whole distribution
	// at 256 positions. The kit samples differently (top-k, another generator), so run.c's sampler
	// is rebuilt here: xorshift64*, a single-precision softmax, top-p.
	const WANT = [
		'Once upon a time, there was a little boy named Timmy. Timmy loved to play with his toys and eat sandwiches. One day, Timmy\'s mom told him it was time to rest for a while. Timmy\'s friend Billy came over and took him a down.',
		'Timmy\'s mom saw that Timmy was sad, but Timmy said, "I didn\'t understand what is it! We need to find some leafs." Timmy thought about it and took a deep breath on a spoon. He hoped it was important to be kind and continued to find its image next time.',
		'After they finished getting, Timmy\'s dad came up to his house and promised to help Timmy.'
	].join('\n');
	const f = Math.fround;
	const MASK = (1n << 64n) - 1n;
	let state = 133742n;
	function randomF32() {
		state ^= state >> 12n;
		state ^= (state << 25n) & MASK;
		state ^= state >> 27n;
		const u32 = Number(((state * 0x2545F4914F6CDD1Dn) & MASK) >> 32n);
		return f((u32 >>> 8) / 16777216);
	}
	function sampleTopp(logits, topp, coin) {
		const n = logits.length, p = new Float32Array(n);
		let max = -Infinity;
		for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
		let sum = f(0);
		for (let i = 0; i < n; i++) { p[i] = Math.exp(logits[i] - max); sum = f(sum + p[i]); }
		for (let i = 0; i < n; i++) p[i] = p[i] / sum;
		const cutoff = f(f(1 - topp) / (n - 1));
		const cand = [];
		for (let i = 0; i < n; i++) if (p[i] >= cutoff) cand.push(i);
		cand.sort((a, b) => (p[b] - p[a]) || (a - b));
		let cumulative = f(0), last = cand.length - 1;
		for (let i = 0; i < cand.length; i++) {
			cumulative = f(cumulative + p[cand[i]]);
			if (cumulative > f(topp)) { last = i; break; }
		}
		const r = f(coin * cumulative);
		let cdf = f(0);
		for (let i = 0; i <= last; i++) {
			cdf = f(cdf + p[cand[i]]);
			if (r < cdf) return cand[i];
		}
		return cand[last];
	}
	const s = model.session(), out = [1];
	for (let pos = 0; pos < 256; pos++) {
		const next = sampleTopp(s.feed(out[out.length - 1]), 0.9, randomF32());
		if (next === 1) break;
		out.push(next);
	}
	equal(model.decode(out), WANT, 'the text');
	return (out.length - 1) + ' sampled tokens equal to upstream\'s';
});

test('generation is the same thing as repeating a full run and taking the best token', () => {
	const ids = [1];
	for (let i = 0; i < 40; i++) {
		const r = model.run(ids, { keep: ['logits'] });
		ids.push(argmax(r.logitsAt(ids.length - 1)));
	}
	equal(ids.join(','), goldenIds.slice(0, 41).join(','), '40 tokens without the cache');
});

// ------------------------------------------------------------------- shapes

const TEXT = 'Once upon a time, there was a little girl named Lily. She loved to play outside in the park.';
const ids = model.encode(TEXT);
const T = ids.length;
let base = null;

test('run returns flat arrays with the documented shapes, and accessors that are views', () => {
	base = model.run(ids, { keep: ['logits', 'resid', 'mlp', 'attn', 'mid', 'pre'] });
	const L = c.layers, H = c.heads;
	equal(base.T, T, 'T');
	equal(base.logits.length, T * c.vocab, 'logits');
	equal(base.resid.length, (L + 1) * T * c.dim, 'resid');
	equal(base.mlp.length, L * T * c.hidden, 'mlp');
	equal(base.attn.length, L * H * T * T, 'attn');
	equal(base.mid.length, L * T * c.dim, 'mid');
	equal(base.pre1.length, L * T * c.hidden, 'pre1');
	equal(JSON.stringify(base.shape), JSON.stringify({
		logits: [T, 512], resid: [6, T, 64], mlp: [5, T, 172], attn: [5, 8, T, T], mid: [5, T, 64], pre1: [5, T, 172], pre3: [5, T, 172]
	}), 'shape');
	for (const k of ['logits', 'resid', 'mlp', 'attn', 'mid', 'pre1', 'pre3']) assert(base[k] instanceof Float32Array, k + ' is not a Float32Array');
	const t = 7, l = 3, h = 5, u = 100;
	equal(base.logitsAt(t).length, 512);
	equal(base.residAt(L, t).length, 64);
	equal(base.mlpAt(l, t).length, 172);
	equal(base.attnAt(l, h, t).length, T);
	assert(base.mlpAt(l, t).buffer === base.mlp.buffer, 'mlpAt should be a view, not a copy');
	equal(base.mlpAt(l, t)[u], base.mlp[(l * T + t) * c.hidden + u], 'mlp index formula');
	equal(base.residAt(l, t)[9], base.resid[(l * T + t) * c.dim + 9], 'resid index formula');
	equal(base.attnAt(l, h, t)[2], base.attn[((l * H + h) * T + t) * T + 2], 'attn index formula');
	equal(base.logitsAt(t)[300], base.logits[t * c.vocab + 300], 'logits index formula');
	throws(() => base.residAt(6, 0), /range/, 'resid station 6');
	throws(() => base.mlpAt(0, T), /range/, 'mlp position T');
	return 'T = ' + T;
});

test('keep: only what is asked for is returned; the default is logits, resid, mlp, attn', () => {
	const def = model.run(ids);
	equal(Object.keys(def.shape).sort().join(','), 'attn,logits,mlp,resid', 'default keep');
	const only = model.run(ids, { keep: ['logits'] });
	equal(Object.keys(only.shape).join(','), 'logits', 'keep logits');
	assert(only.resid === undefined && only.attn === undefined && only.mlp === undefined, 'unasked arrays are present');
	equal(maxDiff(only.logits, base.logits), 0, 'logits do not depend on what is kept');
	throws(() => only.residAt(0, 0), /did not keep/, 'accessor of something not kept');
	throws(() => model.run(ids, { keep: ['logit'] }), /unknown name/, 'a misspelt name');
	equal(Object.keys(model.run(ids, { keep: 'mlp attn' }).shape).sort().join(','), 'attn,mlp', 'keep as a string');
});

test('limits: 512 tokens at most, at least one, ids inside the vocabulary', () => {
	throws(() => model.run([]), /no token ids/, 'an empty sequence');
	throws(() => model.run(new Array(513).fill(1)), /context holds 512/, '513 tokens');
	throws(() => model.run([1, 512]), /ids run from 0 to 511/, 'id 512');
	throws(() => model.run([1, 2.5]), /ids run/, 'a fraction');
	throws(() => model.run('Once'), /array/, 'a string');
	const long = model.generate([1], { temperature: 0.9, seed: 4 });
	if (long.reason === 'context') equal(long.length, 512, 'a full context');
	assert(long.length <= 512, 'generate went past the context');
	const full = new Array(512).fill(0).map((_, i) => goldenIds[i % goldenIds.length]);
	const none = model.generate(full, { maxNew: 5 });
	equal(none.length, 512, 'no room, nothing added');
	equal(none.reason, 'context');
	equal(model.run(full, { keep: ['logits'] }).logits.length, 512 * 512, 'a 512-token run');
});

// ---------------------------------------------------- what the numbers mean

test('resid[0] is the embedding of each token, untouched', () => {
	for (let t = 0; t < T; t++) {
		equal(maxDiff(base.residAt(0, t), model.weights.tokEmb.subarray(ids[t] * c.dim, (ids[t] + 1) * c.dim)), 0, 'position ' + t);
	}
});

test('attention rows are probabilities over the past: non-negative, sum 1, nothing from the future', () => {
	let worst = 0;
	for (let l = 0; l < c.layers; l++) for (let h = 0; h < c.heads; h++) for (let t = 0; t < T; t++) {
		const row = base.attnAt(l, h, t);
		let sum = 0;
		for (let s = 0; s < T; s++) {
			assert(row[s] >= 0, 'negative weight');
			if (s > t) equal(row[s], 0, 'weight on a later position');
			sum += row[s];
		}
		worst = Math.max(worst, Math.abs(sum - 1));
	}
	assert(worst < 1e-5, 'a row sums to 1 +- ' + worst);
	equal(base.attnAt(0, 0, 0)[0], 1, 'the first position can only look at itself');
	return 'largest |sum - 1| = ' + worst.toExponential(1);
});

test('mlp is the hidden activation the output weights multiply: silu(pre1) * pre3, and w2 . mlp is what the block adds', () => {
	let worstAct = 0, worstOut = 0;
	const w2 = model.weights.w2;
	for (let l = 0; l < c.layers; l++) for (let t = 0; t < T; t += 3) {
		const a = base.pre1At(l, t), b = base.pre3At(l, t), hdn = base.mlpAt(l, t);
		for (let u = 0; u < c.hidden; u++) {
			worstAct = Math.max(worstAct, Math.abs(hdn[u] - (a[u] / (1 + Math.exp(-a[u]))) * b[u]));
		}
		const before = base.midAt(l, t), after = base.residAt(l + 1, t);
		for (let d = 0; d < c.dim; d++) {
			let sum = 0;
			for (let u = 0; u < c.hidden; u++) sum += w2[(l * c.dim + d) * c.hidden + u] * hdn[u];
			worstOut = Math.max(worstOut, Math.abs((after[d] - before[d]) - sum));
		}
	}
	assert(worstAct < 1e-5, 'activation formula off by ' + worstAct);
	assert(worstOut < 1e-4, 'output formula off by ' + worstOut);
	return 'largest differences ' + worstAct.toExponential(1) + ' and ' + worstOut.toExponential(1);
});

test('lens: the final residual gives the model\'s own top token at every position', () => {
	const L = c.layers;
	for (let t = 0; t < T; t++) {
		const top = model.lens(base.residAt(L, t), 1)[0];
		equal(top.id, argmax(base.logitsAt(t)), 'top token at position ' + t);
		equal(top.token, model.vocab[top.id]);
		equal(maxDiff(model.lensLogits(base.residAt(L, t)), base.logitsAt(t)), 0, 'lens logits at position ' + t);
	}
	const all = model.lens(base.residAt(L, T - 1), 512);
	const total = all.reduce((s, e) => s + e.prob, 0);
	assert(Math.abs(total - 1) < 1e-9, 'probabilities sum to ' + total);
	for (let i = 1; i < all.length; i++) assert(all[i - 1].logit >= all[i].logit, 'not sorted');
	equal(model.lens(base.residAt(L, T - 1)).length, 5, 'default k');
	const first = model.lens(base.residAt(0, T - 1), 1)[0];
	equal(first.id, ids[T - 1], 'at station 0 the lens returns the token just read (the output matrix is the embedding table)');
	throws(() => model.lens(new Float32Array(10)), /64/, 'a vector of the wrong size');
	return T + ' positions; next token after the text: ' + JSON.stringify(model.lens(base.residAt(L, T - 1), 1)[0].token);
});

// --------------------------------------------------------------------- edits

function logitsWith(edits) {
	return model.run(ids, { edits: edits, keep: ['logits'] }).logits;
}

test('ablate: setting a unit to its own activation changes nothing; setting it to zero changes the logits', () => {
	const cases = [[0, 66, 5], [2, 17, T - 1], [4, 171, 0], [3, 100, 12]];
	for (const [l, u, t] of cases) {
		const own = base.mlpAt(l, t)[u];
		equal(maxDiff(logitsWith({ type: 'ablate', layer: l, unit: u, pos: t, value: own }), base.logits), 0, 'own value at L' + l + ' U' + u + ' pos ' + t);
	}
	// a whole row, one edit per position
	const row = [];
	for (let t = 0; t < T; t++) row.push({ type: 'ablate', layer: 1, unit: 40, pos: t, value: base.mlpAt(1, t)[40] });
	equal(maxDiff(logitsWith(row), base.logits), 0, 'own values at every position');

	const zero = model.run(ids, { edits: { type: 'ablate', layer: 0, unit: 66 } });
	const moved = maxDiff(zero.logits, base.logits);
	assert(moved > 0.01, 'zeroing L0 U66 moved the logits by only ' + moved);
	for (let t = 0; t < T; t++) equal(zero.mlpAt(0, t)[66], 0, 'the recorded activation after ablation, position ' + t);
	const clamp = model.run(ids, { edits: { type: 'ablate', layer: 2, unit: 5, value: 1.5, pos: 4 } });
	equal(clamp.mlpAt(2, 4)[5], 1.5, 'clamped value');
	equal(clamp.mlpAt(2, 3)[5], base.mlpAt(2, 3)[5], 'other positions keep their own value');
	return 'zeroing L0 U66 moves a logit by up to ' + moved.toFixed(2);
});

test('an edit at one position leaves every earlier position exactly as it was', () => {
	const p = 9;
	const out = model.run(ids, { edits: [{ type: 'ablate', layer: 0, unit: 66, pos: p }, { type: 'head', layer: 1, head: 2, pos: p }] });
	equal(maxDiff(out.logits.subarray(0, p * c.vocab), base.logits.subarray(0, p * c.vocab)), 0, 'logits before position ' + p);
	assert(maxDiff(out.logits.subarray(p * c.vocab), base.logits.subarray(p * c.vocab)) > 1e-4, 'nothing changed from position ' + p + ' on');
});

test('patch: a run patched with its own residual changes nothing; with another run\'s, it becomes that run', () => {
	for (let i = 0; i <= c.layers; i++) {
		for (const t of [0, 6, T - 1]) {
			equal(maxDiff(logitsWith({ type: 'patch', layer: i, pos: t, from: base.residAt(i, t) }), base.logits), 0, 'own residual at station ' + i + ' pos ' + t);
		}
	}
	const otherIds = ids.slice();
	otherIds[4] = model.vocab.indexOf(' day');
	otherIds[14] = model.vocab.indexOf(' Tim');
	assert(otherIds[4] > 0 && otherIds[14] > 0, 'test tokens missing from the vocabulary');
	const other = model.run(otherIds);
	assert(maxDiff(other.logits, base.logits) > 0.1, 'the second text should differ');
	// every position at the last station: the logits become the other run's exactly
	for (const station of [c.layers, 0, 3]) {
		const all = [];
		for (let t = 0; t < T; t++) all.push({ type: 'patch', layer: station, pos: t, from: other.residAt(station, t) });
		const out = model.run(ids, { edits: all });
		equal(maxDiff(out.logits, other.logits), 0, 'all positions patched at station ' + station);
		equal(maxDiff(out.residAt(station, 3), other.residAt(station, 3)), 0, 'the recorded residual is the patched one');
	}
	// one position, mid-stream: the prediction moves towards the other run
	const one = model.run(ids, { edits: { type: 'patch', layer: 2, pos: 14, from: other.residAt(2, 14) }, keep: ['logits'] });
	assert(maxDiff(one.logits, base.logits) > 1e-3, 'a single patch changed nothing');
	equal(maxDiff(one.logits.subarray(0, 14 * c.vocab), base.logits.subarray(0, 14 * c.vocab)), 0, 'positions before the patch');
	throws(() => model.run(ids, { edits: { type: 'patch', layer: 2, from: base.residAt(2, 0) } }), /pos is missing/, 'a patch without a position');
});

test('steer: alpha 0 changes nothing; otherwise resid[layer] moves by exactly alpha * vec', () => {
	const lily = model.vocab.indexOf(' Lily');
	const vec = model.weights.wcls.subarray(lily * c.dim, (lily + 1) * c.dim);
	equal(maxDiff(logitsWith({ type: 'steer', layer: 2, vec: vec, alpha: 0 }), base.logits), 0, 'alpha 0');
	for (const station of [0, 3, 5]) {
		const out = model.run(ids, { edits: { type: 'steer', layer: station, vec: vec, alpha: 2 } });
		let worst = 0;
		for (let t = 0; t < T; t++) for (let d = 0; d < c.dim; d++) {
			worst = Math.max(worst, Math.abs(out.residAt(station, t)[d] - (base.residAt(station, t)[d] + 2 * vec[d])));
		}
		assert(worst < 1e-5, 'station ' + station + ' moved by something else: ' + worst);
		if (station > 0) equal(maxDiff(out.resid.subarray(0, station * T * c.dim), base.resid.subarray(0, station * T * c.dim)), 0, 'stations before ' + station);
	}
	const t = T - 1;
	const before = LLM.softmax(base.logitsAt(t))[lily];
	const after = LLM.softmax(model.run(ids, { edits: { type: 'steer', layer: 5, vec: vec, alpha: 4, pos: t }, keep: ['logits'] }).logitsAt(t))[lily];
	assert(after > 0.9 && before < 0.05, 'steering along the row of " Lily" took its probability from ' + before + ' to ' + after);
	const only = model.run(ids, { edits: { type: 'steer', layer: 3, vec: vec, alpha: 1, pos: 8 } });
	equal(maxDiff(only.residAt(3, 7), base.residAt(3, 7)), 0, 'pos limits the steer to one position');
	equal(maxDiff(model.run(ids, { edits: { type: 'steer', layer: 3, vec: vec } }).logits, model.run(ids, { edits: { type: 'steer', layer: 3, vec: Array.from(vec), alpha: 1 } }).logits), 0, 'alpha defaults to 1; a plain array works');
	return 'p(" Lily") after the text: ' + before.toFixed(4) + ' -> ' + after.toFixed(4) + ' with alpha 4 at the last station';
});

test('head: scale 1 changes nothing; scale 0 removes the head\'s output', () => {
	equal(maxDiff(logitsWith({ type: 'head', layer: 3, head: 4, scale: 1 }), base.logits), 0, 'scale 1');
	const off = model.run(ids, { edits: { type: 'head', layer: 4, head: 0 } });
	const moved = maxDiff(off.logits, base.logits);
	assert(moved > 1e-3, 'switching a head off moved nothing');
	equal(maxDiff(off.attn.subarray(0, 4 * c.heads * T * T), base.attn.subarray(0, 4 * c.heads * T * T)), 0, 'attention before that block');
	equal(maxDiff(off.attnAt(4, 0, T - 1), base.attnAt(4, 0, T - 1)), 0, 'the head still looks where it looked; only its output is scaled');
	// every head of one block off is the same as that block having no attention at all: mid = resid
	const all = [];
	for (let h = 0; h < c.heads; h++) all.push({ type: 'head', layer: 2, head: h, scale: 0 });
	const none = model.run(ids, { edits: all, keep: ['resid', 'mid'] });
	equal(maxDiff(none.mid.subarray(2 * T * c.dim, 3 * T * c.dim), none.resid.subarray(2 * T * c.dim, 3 * T * c.dim)), 0, 'block 2 without attention');
	return 'switching off L4 H0 moves a logit by up to ' + moved.toFixed(2);
});

test('bad edits are refused in plain words', () => {
	const v = new Float32Array(64);
	throws(() => logitsWith({ type: 'ablate', layer: 5, unit: 0 }), /layer 5 is out of range 0\.\.4/);
	throws(() => logitsWith({ type: 'ablate', layer: 0, unit: 172 }), /unit 172 is out of range 0\.\.171/);
	throws(() => logitsWith({ type: 'ablate', layer: 0, unit: 1, pos: T }), /pos \d+ is out of range/);
	throws(() => logitsWith({ type: 'ablate', layer: 0, unit: 1, value: NaN }), /finite/);
	throws(() => logitsWith({ type: 'head', layer: 0, head: 8 }), /head 8 is out of range 0\.\.7/);
	throws(() => logitsWith({ type: 'steer', layer: 6, vec: v }), /layer 6 is out of range 0\.\.5/);
	throws(() => logitsWith({ type: 'steer', layer: 1, vec: new Float32Array(63) }), /63 numbers; it needs 64/);
	throws(() => logitsWith({ type: 'steer', layer: 1 }), /vec must be an array/);
	throws(() => logitsWith({ type: 'zap', layer: 1 }), /unknown type "zap"/);
	throws(() => logitsWith([null]), /not an object/);
	equal(maxDiff(logitsWith([]), base.logits), 0, 'an empty list of edits');
	equal(maxDiff(logitsWith(null), base.logits), 0, 'no edits');
});

test('copyEdits makes small copies of the vectors (for sending to the worker)', () => {
	const e = { type: 'patch', layer: 2, pos: 3, from: base.residAt(2, 3) };
	const copy = LLM.copyEdits(e);
	equal(copy.length, 1);
	equal(copy[0].from.buffer.byteLength, 64 * 4, 'the copy carries only its own 64 numbers');
	equal(maxDiff(copy[0].from, e.from), 0);
	equal(copy[0].type + copy[0].layer + copy[0].pos, 'patch23');
	equal(LLM.copyEdits(null).length, 0);
});

// ------------------------------------------------- cache, sessions, sampling

test('the key-value cache gives the same logits as a full run', () => {
	const s = model.session();
	let worst = 0;
	for (let t = 0; t < T; t++) worst = Math.max(worst, maxDiff(s.feed(ids[t]), base.logitsAt(t)));
	equal(worst, 0, 'largest difference');
	equal(s.pos, T, 'positions fed');
	const longIds = goldenIds;
	const full = model.run(longIds, { keep: ['logits'] });
	const s2 = model.session();
	let worst2 = 0;
	for (let t = 0; t < longIds.length; t++) worst2 = Math.max(worst2, maxDiff(s2.feed(longIds[t]), full.logitsAt(t)));
	equal(worst2, 0, 'largest difference over 257 tokens');
	return T + ' and ' + longIds.length + ' positions, largest difference 0';
});

test('the cache agrees with a full run under edits too', () => {
	const lily = model.vocab.indexOf(' Lily');
	const vec = model.weights.wcls.subarray(lily * c.dim, (lily + 1) * c.dim);
	const edits = [
		{ type: 'ablate', layer: 0, unit: 66 },
		{ type: 'ablate', layer: 3, unit: 9, value: 2, pos: 6 },
		{ type: 'head', layer: 2, head: 1, scale: 0.5 },
		{ type: 'steer', layer: 2, vec: vec, alpha: 0.7 },
		{ type: 'steer', layer: 0, vec: vec, alpha: -1, pos: 3 },
		{ type: 'patch', layer: 4, pos: 10, from: base.residAt(4, 2) }
	];
	const full = model.run(ids, { edits: edits, keep: ['logits'] });
	assert(maxDiff(full.logits, base.logits) > 0.1, 'the edits should matter');
	const s = model.session({ edits: edits });
	let worst = 0;
	for (let t = 0; t < T; t++) worst = Math.max(worst, maxDiff(s.feed(ids[t]), full.logitsAt(t)));
	equal(worst, 0, 'largest difference');
	// and generate() with edits is the edited run, token after token
	const prompt = ids.slice(0, 8);
	const gen = model.generate(prompt, { maxNew: 12, edits: edits.slice(0, 5) });
	const check = model.run(gen, { edits: edits.slice(0, 5), keep: ['logits'] });
	for (let t = 7; t < gen.length - 1; t++) equal(gen[t + 1], argmax(check.logitsAt(t)), 'token ' + (t + 1) + ' under edits');
});

test('sampling: the same seed gives the same sample; another seed gives another', () => {
	const prompt = model.encode('Once upon a time');
	const o = { temperature: 0.8, topK: 40, maxNew: 60 };
	const a = model.generate(prompt, Object.assign({ seed: 7 }, o));
	const b = model.generate(prompt, Object.assign({ seed: 7 }, o));
	const d = model.generate(prompt, Object.assign({ seed: 8 }, o));
	equal(a.join(','), b.join(','), 'seed 7 twice');
	assert(a.join(',') !== d.join(','), 'seeds 7 and 8 gave the same sample');
	equal(model.generate(prompt, Object.assign({ seed: 'lily' }, o)).join(','), model.generate(prompt, Object.assign({ seed: 'lily' }, o)).join(','), 'a text seed twice');
	assert(model.generate(prompt, Object.assign({ seed: 'lily' }, o)).join(',') !== model.generate(prompt, Object.assign({ seed: 'tom' }, o)).join(','), 'two text seeds gave the same sample');
	equal(model.generate(prompt, { temperature: 0, seed: 1, maxNew: 30 }).join(','), model.generate(prompt, { temperature: 0, seed: 2, maxNew: 30 }).join(','), 'temperature 0 ignores the seed');
	equal(model.generate(prompt, { temperature: 1.3, topK: 1, seed: 5, maxNew: 30 }).join(','), model.generate(prompt, { maxNew: 30 }).join(','), 'topK 1 is greedy');
	equal(a.slice(0, prompt.length).join(','), prompt.join(','), 'the result starts with the prompt');
	return JSON.stringify(model.decode(a).slice(0, 70)) + '...';
});

test('sampling: topK really limits the draw, and the stream is the same thing step by step', () => {
	const prompt = model.encode('The dog');
	const run = model.run(prompt, { keep: ['logits'] });
	const logits = run.logitsAt(prompt.length - 1);
	const order = Array.from(logits.keys()).sort((x, y) => logits[y] - logits[x]);
	const top3 = new Set(order.slice(0, 3));
	const seen = new Set();
	for (let seed = 1; seed <= 60; seed++) {
		const out = model.generate(prompt, { temperature: 5, topK: 3, seed: seed, maxNew: 1, stopAtBos: false });
		assert(top3.has(out[prompt.length]), 'a token outside the top 3 was drawn');
		seen.add(out[prompt.length]);
	}
	equal(seen.size, 3, 'at temperature 5 all three should turn up in 60 draws');
	const st = model.stream(prompt, { temperature: 0.8, topK: 40, seed: 3, maxNew: 25 });
	const got = [];
	let text = '';
	for (let id = st.next(); id >= 0; id = st.next()) { got.push(id); text += st.text; }
	const whole = model.generate(prompt, { temperature: 0.8, topK: 40, seed: 3, maxNew: 25 });
	equal(prompt.concat(got).join(','), whole.join(','), 'stream and generate');
	equal(st.done, true);
	equal(st.reason, 'length');
	equal(model.decode(prompt) + text, model.decode(whole), 'the pieces of text join up');
	throws(() => model.generate(prompt, { topK: -1 }), /topK/);
	throws(() => model.generate(prompt, { maxNew: 1.5 }), /maxNew/);
	throws(() => model.generate([], {}), /no token ids/);
});

// -------------------------------------------------------------- unit writes

test('unitWrites is the unit\'s column of w2 through the final gain and the unembedding', () => {
	const l = 4, u = 10;
	const uw = model.unitWrites(l, u, 6);
	const w = model.weights;
	for (let d = 0; d < c.dim; d++) equal(uw.vec[d], w.w2[(l * c.dim + d) * c.hidden + u], 'vec[' + d + ']');
	for (const v of [0, 13, 317, 511]) {
		let sum = 0;
		for (let d = 0; d < c.dim; d++) sum += w.wcls[v * c.dim + d] * w.rmsFinal[d] * uw.vec[d];
		assert(Math.abs(uw.effect[v] - sum) < 1e-6, 'effect[' + v + ']');
	}
	equal(uw.up.length, 6);
	equal(uw.down.length, 6);
	equal(uw.up[0].value, Math.max(...uw.effect), 'the first of "up" is the largest push');
	equal(uw.down[0].value, Math.min(...uw.effect), 'the first of "down" is the largest pull');
	for (let i = 1; i < 6; i++) assert(uw.up[i - 1].value >= uw.up[i].value && uw.down[i - 1].value <= uw.down[i].value, 'not sorted');
	equal(uw.up[0].token, model.vocab[uw.up[0].id]);
	equal(model.unitWrites(0, 0).up.length, 8, 'default k');
	throws(() => model.unitWrites(5, 0), /layer 5/);
	throws(() => model.unitWrites(0, 172), /unit 172/);
});

test('unitWrites predicts what nudging a unit does in the last block, and much less in earlier ones', () => {
	// raise a unit by 1 at the last position and compare the change in logits with .effect
	const t = T - 1;
	const medians = [];
	for (let l = 0; l < c.layers; l++) {
		const units = [], sets = [];
		for (let u = 0; u < c.hidden; u += 7) {
			units.push(u);
			sets.push({ type: 'ablate', layer: l, unit: u, pos: t, value: base.mlpAt(l, t)[u] + 1 });
		}
		const sw = model.sweep(ids, sets, { logits: true, loss: false });
		const cors = units.map((u, i) => {
			const delta = new Float64Array(c.vocab);
			for (let v = 0; v < c.vocab; v++) delta[v] = sw.logits[i * c.vocab + v] - base.logits[t * c.vocab + v];
			return pearson(delta, model.unitWrites(l, u).effect);
		});
		cors.sort((x, y) => x - y);
		medians.push(cors[cors.length >> 1]);
	}
	// the README quotes these
	equal(medians.map((m) => m.toFixed(2)).join(', '), '0.33, 0.28, 0.56, 0.63, 0.99', 'median correlation by block, 25 units each');
	return 'median correlation by block: ' + medians.map((m) => m.toFixed(2)).join(', ');
});

test('unitWrites: effect is a direction, push (given the stream at a position) is the size, norm included', () => {
	// The review's case: last-block unit 96 and " She" on the README's 45-token sentence.
	const S = model.encode('Once upon a time, there was a little girl named Lily. She loved to play outside in the park. One day, she saw a big, red ball.');
	const b = model.run(S, { keep: ['logits', 'resid', 'mlp'] });
	const she = model.vocab.indexOf(' She');
	const real = (l, u, t, step) => {
		const e = model.run(S, { edits: { type: 'ablate', layer: l, unit: u, pos: t, value: b.mlpAt(l, t)[u] + step }, keep: ['logits'] });
		const d = new Float64Array(c.vocab);
		for (let v = 0; v < c.vocab; v++) d[v] = (e.logitsAt(t)[v] - b.logitsAt(t)[v]) / step;
		return d;
	};
	const effect = model.unitWrites(4, 96).effect[she];
	const got = [5, 20, 44].map((t) => {
		const r = real(4, 96, t, 1)[she];
		const w = model.unitWrites(4, 96, 8, b.residAt(5, t));
		// a whole step of 1 is not small next to the stream's length (about 1 to 2 here): push is
		// nearer than effect, and the lens of the moved stream is exact for the last block
		assert(Math.abs(w.push[she] - r) < Math.abs(effect - r), 'push ' + w.push[she] + ' against real ' + r + ' at ' + t);
		const moved = Float32Array.from(b.residAt(5, t), (x, d) => x + w.vec[d]);
		const exact = model.lensLogits(moved)[she] - model.lensLogits(b.residAt(5, t))[she];
		assert(Math.abs(exact - r) < 1e-4, 'lens of the moved stream ' + exact + ' against real ' + r);
		return r;
	});
	equal(effect.toFixed(2), '-2.18', 'effect of L4 U96 on " She"');
	equal(got.map((x) => x.toFixed(2)).join(', '), '-1.39, -1.46, -1.80', 'the real change from +1 at positions 5, 20, 44');
	// For small steps push is the derivative: over all 172 last-block units at six positions
	// it matches the change in every logit to within 1% of the largest change; effect alone
	// is off by more than half of it at the median.
	let worstPush = 0;
	const effErr = [];
	for (let u = 0; u < c.hidden; u++) for (const t of [1, 5, 12, 20, 33, 44]) {
		const d = real(4, u, t, 0.01), w = model.unitWrites(4, u, 1, b.residAt(5, t));
		let big = 0, ep = 0, ee = 0;
		for (let v = 0; v < c.vocab; v++) {
			big = Math.max(big, Math.abs(d[v]));
			ep = Math.max(ep, Math.abs(d[v] - w.push[v]));
			ee = Math.max(ee, Math.abs(d[v] - w.effect[v]));
		}
		worstPush = Math.max(worstPush, ep / big);
		effErr.push(ee / big);
	}
	effErr.sort((x, y) => x - y);
	assert(worstPush < 0.01, 'push is off by ' + worstPush + ' of the largest change');
	assert(effErr[effErr.length >> 1] > 0.5, 'effect alone should be far off');
	// the rms it reports is the final norm's divisor
	const x = b.residAt(5, 44);
	let ss = 0;
	for (const v of x) ss += v * v;
	assert(Math.abs(model.unitWrites(4, 96, 1, x).rms - Math.sqrt(ss / 64 + 1e-5)) < 1e-9, 'rms');
	equal(model.unitWrites(4, 96).push, undefined, 'no push without a stream');
	// the README: the stream's rms at station 5 runs 1.05 to 2.1 after the start token, 2.3 at it
	const rmsAt = (t) => model.unitWrites(4, 96, 1, b.residAt(5, t)).rms;
	const rs = [];
	for (let t = 1; t < b.T; t++) rs.push(rmsAt(t));
	equal([Math.min(...rs).toFixed(2), Math.max(...rs).toFixed(1), rmsAt(0).toFixed(1)].join(' '), '1.05 2.1 2.3', 'rms range');
	throws(() => model.unitWrites(4, 96, 8, new Float32Array(10)), /at has 10 numbers/);
	return 'push within ' + (worstPush * 100).toFixed(2) + '% of the largest change over 1,032 unit/position pairs; effect alone off by ' + (effErr[effErr.length >> 1] * 100).toFixed(0) + '% at the median';
});

test('misspelt option names and a negative temperature are refused, not ignored', () => {
	const p = model.encode('Once upon a time');
	throws(() => model.run(p, { edits: { type: 'ablate', layer: 0, unit: 66, position: 3 } }), /unknown option "position"/);
	throws(() => model.run(p, { edits: { type: 'steer', layer: 1, vec: new Float32Array(64), aplha: 5 } }), /unknown option "aplha"/);
	throws(() => model.run(p, { edits: { type: 'head', layer: 0, head: 1, value: 0 } }), /unknown option "value"/);
	throws(() => model.run(p, { kepe: ['logits'] }), /run: unknown option "kepe"/);
	throws(() => model.generate(p, { maxnew: 3 }), /generate: unknown option "maxnew"/);
	throws(() => model.stream(p, { topk: 3 }), /unknown option "topk"/);
	throws(() => model.generate(p, { temperature: -1, maxNew: 5 }), /temperature must be 0 or more/);
	throws(() => model.session({ edit: [] }), /session: unknown option "edit"/);
	throws(() => model.sweep(p, [], { target: 5, logit: true }), /sweep: unknown option "logit"/);
	throws(() => model.sweep(p, [], { onProgress: () => {} }), /onProgress is for llm\.sweep/);
	throws(() => model.loss(p, { edit: [] }), /loss: unknown option "edit"/);
	throws(() => model.encode('a', { bos: false, eso: true }), /encode: unknown option "eso"/);
	throws(() => model.checkEdits([{ type: 'patch', layer: 1, pos: 0, from: new Float32Array(64), alpha: 2 }]), /unknown option "alpha"/);
	// every documented name still passes
	model.run(p, { edits: [{ type: 'ablate', layer: 0, unit: 1, value: 0, pos: 1 }, { type: 'head', layer: 0, head: 1, scale: 0.5, pos: 1 },
		{ type: 'steer', layer: 1, vec: new Float32Array(64), alpha: 1, pos: 2 }, { type: 'patch', layer: 1, pos: 0, from: base.residAt(1, 0) }], keep: ['logits'] });
	model.generate(p, { maxNew: 2, temperature: 0.5, topK: 3, seed: 1, edits: [], onToken: () => {}, stopAtBos: false });
	model.sweep(p, [{ type: 'ablate', layer: 0, unit: 1 }], { at: 1, target: 5, loss: false, logits: true, base: [] });
	model.loss(p, { edits: [] });
	model.encode('a', { bos: true, eos: true });
	equal(LLM.optionNames.sweep.indexOf('onProgress') >= 0, true, 'the client checks llm.sweep against the same names plus onProgress');
});

test('the tokenizer: well-formed text round-trips; a lone surrogate becomes U+FFFD; id 0 is never produced', () => {
	const u = (...codes) => String.fromCharCode(...codes);
	const texts = ['', 'a', 'Hello, world!', ' two  spaces ', 'line' + u(10) + 'break' + u(9) + 'tab', 'caf' + u(0xE9), u(0x3B1, 0x3B2), u(0xD83D, 0xDE00) + ' smile', '<s></s><0x41>', 'Once upon a time'];
	for (const s of texts) {
		equal(model.decode(model.encode(s)), s, 'round trip of ' + JSON.stringify(s));
		assert(model.encode(s).indexOf(0) < 0, 'id 0 in ' + JSON.stringify(s));
	}
	equal(model.decode(model.encode('a' + u(0xD800) + 'b')), 'a' + u(0xFFFD) + 'b', 'a lone surrogate');
});

// --------------------------------------------------------------------- sweep

function measuresOf(logits, baseLogits, target, nextIds) {
	// from full logits [T][vocab]: kl at the last position, p(target), top, mean loss
	const V = c.vocab, at = T - 1;
	const lp = logSoftmax(logits.subarray(at * V, (at + 1) * V));
	const bp = logSoftmax(baseLogits.subarray(at * V, (at + 1) * V));
	let kl = 0;
	for (let v = 0; v < V; v++) kl += Math.exp(bp[v]) * (bp[v] - lp[v]);
	let nll = 0;
	for (let t = 0; t < T - 1; t++) nll -= logSoftmax(logits.subarray(t * V, (t + 1) * V))[nextIds[t + 1]];
	return { kl: Math.max(kl, 0), pTarget: Math.exp(lp[target]), top: argmax(lp), loss: nll / (T - 1) };
}

function randomEdits(rand, n) {
	const lily = model.vocab.indexOf(' Lily');
	const vec = model.weights.wcls.subarray(lily * c.dim, (lily + 1) * c.dim);
	const sets = [];
	for (let i = 0; i < n; i++) {
		const set = [];
		const k = 1 + Math.floor(rand() * 2);
		for (let j = 0; j < k; j++) {
			const kind = Math.floor(rand() * 4);
			const pos = rand() < 0.5 ? Math.floor(rand() * T) : undefined;
			if (kind === 0) set.push({ type: 'ablate', layer: Math.floor(rand() * 5), unit: Math.floor(rand() * 172), value: rand() < 0.5 ? 0 : rand() * 4 - 2, pos: pos });
			else if (kind === 1) set.push({ type: 'head', layer: Math.floor(rand() * 5), head: Math.floor(rand() * 8), scale: rand() < 0.5 ? 0 : 2, pos: pos });
			else if (kind === 2) set.push({ type: 'steer', layer: Math.floor(rand() * 6), vec: vec, alpha: rand() * 2 - 1, pos: pos });
			else set.push({ type: 'patch', layer: Math.floor(rand() * 6), pos: Math.floor(rand() * T), from: base.residAt(Math.floor(rand() * 6), Math.floor(rand() * T)) });
		}
		sets.push(k === 1 && rand() < 0.5 ? set[0] : set);
	}
	return sets;
}

test('sweep gives exactly what one edited run after another gives (it only skips work that cannot change)', () => {
	const sets = randomEdits(LLM.rng(11), 48);
	sets.push([]);                                                  // no edit at all: the baseline itself
	sets.push({ type: 'steer', layer: 5, vec: new Float32Array(64).fill(0.1) });
	sets.push({ type: 'ablate', layer: 4, unit: 3, pos: T - 1 });
	// the cases where a member may, or may not, start after the attention of its first block
	const v = new Float32Array(64).fill(0.05);
	sets.push({ type: 'ablate', layer: 2, unit: 7 });
	sets.push([{ type: 'ablate', layer: 2, unit: 7 }, { type: 'ablate', layer: 2, unit: 8, value: 1, pos: 3 }]);
	sets.push([{ type: 'ablate', layer: 2, unit: 7 }, { type: 'head', layer: 2, head: 1 }]);
	sets.push([{ type: 'ablate', layer: 2, unit: 7 }, { type: 'steer', layer: 2, vec: v }]);
	sets.push([{ type: 'ablate', layer: 2, unit: 7 }, { type: 'steer', layer: 3, vec: v }]);
	sets.push([{ type: 'ablate', layer: 2, unit: 7, pos: 9 }, { type: 'patch', layer: 3, pos: 4, from: v }]);
	sets.push([{ type: 'ablate', layer: 1, unit: 0 }, { type: 'ablate', layer: 3, unit: 0 }, { type: 'head', layer: 3, head: 0 }]);
	sets.push([{ type: 'ablate', layer: 4, unit: 100 }, { type: 'steer', layer: 5, vec: v, pos: 6 }]);
	sets.push({ type: 'ablate', layer: 0, unit: 66, pos: 0 });
	const sw = model.sweep(ids, sets, { logits: true });
	equal(sw.n, sets.length, 'n');
	equal(sw.done, sets.length, 'done');
	equal(sw.at, T - 1, 'at');
	equal(sw.target, argmax(base.logitsAt(T - 1)), 'the default target is the baseline\'s top token');
	equal(maxDiff(sw.base.logits, base.logitsAt(T - 1)), 0, 'baseline logits');
	let worstLogit = 0, worst = 0;
	for (let i = 0; i < sets.length; i++) {
		const full = model.run(ids, { edits: sets[i], keep: ['logits'] }).logits;
		worstLogit = Math.max(worstLogit, maxDiff(sw.logits.subarray(i * c.vocab, (i + 1) * c.vocab), full.subarray((T - 1) * c.vocab)));
		const m = measuresOf(full, base.logits, sw.target, ids);
		worst = Math.max(worst, Math.abs(m.kl - sw.kl[i]), Math.abs(m.pTarget - sw.pTarget[i]), Math.abs(m.loss - sw.loss[i]));
		equal(sw.top[i], m.top, 'top token of set ' + i);
	}
	equal(worstLogit, 0, 'largest difference in logits');
	assert(worst < 1e-5, 'largest difference in a measure: ' + worst);
	const b = measuresOf(base.logits, base.logits, sw.target, ids);
	assert(Math.abs(sw.base.loss - b.loss) < 1e-6 && Math.abs(sw.base.pTarget - b.pTarget) < 1e-6, 'baseline measures');
	equal(sw.kl[48], 0, 'an empty edit set has no effect');
	assert(Math.abs(sw.loss[48] - sw.base.loss) < 1e-7, 'an empty edit set has the baseline loss');
	for (let i = 0; i < sw.n; i++) assert(sw.kl[i] >= 0, 'negative KL');
	return sets.length + ' edit sets; baseline loss ' + sw.base.loss.toFixed(3) + ' nats per token';
});

test('sweep with base edits, another position and another target still matches plain runs', () => {
	const lily = model.vocab.indexOf(' Lily');
	const vec = model.weights.wcls.subarray(lily * c.dim, (lily + 1) * c.dim);
	const baseEdits = [{ type: 'steer', layer: 1, vec: vec, alpha: 0.5 }, { type: 'ablate', layer: 2, unit: 30, pos: 4 }, { type: 'patch', layer: 3, pos: 2, from: base.residAt(3, 9) }];
	const sets = randomEdits(LLM.rng(23), 24);
	const at = 10;
	const sw = model.sweep(ids, sets, { base: baseEdits, at: at, target: lily, logits: true, loss: false });
	equal(sw.loss, null, 'loss: false');
	const ref = model.run(ids, { edits: baseEdits, keep: ['logits'] });
	equal(maxDiff(sw.base.logits, ref.logitsAt(at)), 0, 'baseline with base edits');
	let worst = 0;
	for (let i = 0; i < sets.length; i++) {
		const full = model.run(ids, { edits: baseEdits.concat(sets[i]), keep: ['logits'] });
		worst = Math.max(worst, maxDiff(sw.logits.subarray(i * c.vocab, (i + 1) * c.vocab), full.logitsAt(at)));
		assert(Math.abs(sw.pTarget[i] - LLM.softmax(full.logitsAt(at))[lily]) < 1e-6, 'pTarget of set ' + i);
	}
	equal(worst, 0, 'largest difference in logits');
	throws(() => model.sweep(ids, [{ type: 'ablate', layer: 0, unit: 0 }, { type: 'ablate', layer: 9, unit: 0 }]), /edit set 1: .*layer 9/, 'a bad edit names its set');
	throws(() => model.sweep(ids, {}), /must be an array/);
	throws(() => model.sweep(ids, [], { at: T }), /at/);
	equal(model.sweep(ids, []).n, 0, 'an empty sweep');
	const lone = model.sweep([1], [[]]);
	equal(Number.isNaN(lone.base.loss), true, 'one token has no next token to be surprised by');
	equal(lone.loss, null, 'and so no loss per edit set');
});

test('a sweeper can be driven one edit set at a time; what is not run yet reads NaN', () => {
	const sets = [];
	for (let u = 0; u < 6; u++) sets.push({ type: 'ablate', layer: 3, unit: u });
	const s = model.sweeper(ids, sets);
	equal(s.n, 6);
	equal(s.done, false);
	assert(Number.isNaN(s.kl[0]) && s.top[0] === -1, 'entries start as NaN and -1');
	s.next();
	s.next();
	equal(s.i, 2, 'two done');
	assert(s.kl[1] >= 0 && Number.isNaN(s.kl[2]) && Number.isNaN(s.loss[5]), 'done entries are numbers, the rest NaN');
	const part = s.result();
	equal(part.done, 2);
	while (s.next()) { /* the rest */ }
	equal(s.done, true);
	equal(maxDiff(s.result().kl, model.sweep(ids, sets).kl), 0, 'the same numbers as sweep()');
	equal(model.checkEdits(sets, T), true, 'checkEdits accepts good edits');
	throws(() => model.checkEdits({ type: 'ablate', layer: 0, unit: 0, pos: T }, T), /pos/, 'checkEdits with a length');
	equal(model.checkEdits({ type: 'ablate', layer: 0, unit: 0, pos: 400 }), true, 'checkEdits without a length allows any position in the context');
	equal(model.checkIds(ids), T, 'checkIds');
});

test('a sweep over all 860 units of one position finishes, and finds units that matter', () => {
	const sets = [];
	for (let l = 0; l < c.layers; l++) for (let u = 0; u < c.hidden; u++) sets.push({ type: 'ablate', layer: l, unit: u, pos: T - 1 });
	const t0 = performance.now();
	const sw = model.sweep(ids, sets);
	const ms = performance.now() - t0;
	let best = 0;
	for (let i = 1; i < sw.n; i++) if (sw.kl[i] > sw.kl[best]) best = i;
	assert(sw.kl[best] > 0.01, 'no unit moved the prediction');
	return '860 single-position ablations in ' + ms.toFixed(0) + ' ms; largest KL ' + sw.kl[best].toFixed(3) + ' at L' + sets[best].layer + ' U' + sets[best].unit;
});

// ------------------------------------------------- what README.md quotes
//
// The README gives measured numbers and worked examples. They are pinned here,
// so the document cannot drift away from what the kit does.

function vectorLength(v) {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i] * v[i];
	return Math.sqrt(s);
}

const README_SWEEP_COUNTS = '48 raise, 208 lower';

test('README: the measurements on its 45-token sentence', () => {
	equal(JSON.stringify(model.encode('Once upon a time')), '[1,403,407,261,378]', 'ids of "Once upon a time"');
	const S = 'Once upon a time, there was a little girl named Lily. She loved to play outside in the park. One day, she saw a big, red ball.';
	const sIds = model.encode(S);
	equal(sIds.length, 45, 'tokens');
	const r = model.run(sIds);
	const means = [], longest = [], agree = [];
	for (let i = 0; i <= c.layers; i++) {
		let sum = 0, best = 0, hit = 0;
		for (let t = 0; t < r.T; t++) {
			const n = vectorLength(r.residAt(i, t));
			sum += n;
			if (n > vectorLength(r.residAt(i, best))) best = t;
			if (model.lens(r.residAt(i, t), 1)[0].id === argmax(r.logitsAt(t))) hit++;
		}
		means.push((sum / r.T).toFixed(1));
		longest.push(best);
		agree.push(hit);
	}
	equal(means.join(', '), '2.0, 4.0, 5.6, 7.6, 10.5, 13.0', 'mean length of the residual by station');
	equal(longest.slice(1).join(','), '0,0,0,0,0', 'the start token has the longest residual from station 1 on');
	equal(agree.join(', '), '0, 1, 2, 12, 25, 45', 'positions where the lens already names the final top token');
	let own = 0, lowest = 1;
	for (let t = 0; t < r.T; t++) {
		const top = model.lens(r.residAt(0, t), 1)[0];
		if (top.id === sIds[t]) own++;
		lowest = Math.min(lowest, top.prob);
	}
	equal(own, 45, 'at station 0 the lens returns the token just read');
	equal(lowest.toFixed(2), '0.98', 'and the lowest probability it gives it');
	const negative = [], nearZero = [];
	for (let l = 0; l < c.layers; l++) {
		let n = 0, neg = 0, near = 0;
		for (let t = 0; t < r.T; t++) {
			const a = r.mlpAt(l, t);
			for (let u = 0; u < a.length; u++) { n++; if (a[u] < 0) neg++; if (Math.abs(a[u]) < 0.05) near++; }
		}
		negative.push(Math.round(neg / n * 100));
		nearZero.push(Math.round(near / n * 100));
	}
	equal(negative.join(', '), '48, 50, 49, 49, 50', 'percent of activations below zero, by block');
	equal(nearZero.join(', '), '47, 39, 35, 28, 24', 'percent of activations within 0.05 of zero, by block');
	let lo = 1, hi = 0;
	for (let l = 0; l < c.layers; l++) for (let h = 0; h < c.heads; h++) {
		let s = 0;
		for (let t = 1; t < r.T; t++) s += r.attnAt(l, h, t)[0];
		s /= r.T - 1;
		lo = Math.min(lo, s);
		hi = Math.max(hi, s);
	}
	equal(lo.toFixed(2) + ' to ' + hi.toFixed(2), '0.01 to 0.22', 'mean attention on position 0, per head');

	// the ablation table of that sentence: every unit zeroed at every position
	const sets = [];
	for (let l = 0; l < c.layers; l++) for (let u = 0; u < c.hidden; u++) sets.push({ type: 'ablate', layer: l, unit: u });
	const sw = model.sweep(sIds, sets);
	equal(sw.base.loss.toFixed(3), '0.324', 'unedited loss');
	let worst = 0, raise = 0, lower = 0;
	for (let i = 0; i < sw.n; i++) {
		if (sw.loss[i] > sw.loss[worst]) worst = i;
		if (sw.loss[i] - sw.base.loss > 0.01) raise++;
		if (sw.loss[i] - sw.base.loss < -0.001) lower++;
	}
	equal('L' + sets[worst].layer + ' U' + sets[worst].unit + ' ' + sw.loss[worst].toFixed(3), 'L0 U66 0.471', 'the unit whose removal hurts most');
	equal(raise + ' raise, ' + lower + ' lower', README_SWEEP_COUNTS, 'units that raise the loss by more than 0.01, or lower it by more than 0.001');
	return 'residual lengths ' + means.join(', ') + '; ablation table: ' + raise + ' units raise the loss by more than 0.01, ' + lower + ' lower it by more than 0.001';
});

test('README: stories end by themselves, text runs at 2.25 characters a token, anything becomes a story', () => {
	const lengths = [];
	for (let seed = 1; seed <= 10; seed++) {
		const out = model.generate([1], { temperature: 0.8, topK: 40, seed: seed });
		lengths.push((out.length - 1) + ' ' + out.reason);
	}
	equal(lengths.join(', '), '419 bos, 223 bos, 340 bos, 511 context, 295 bos, 175 bos, 268 bos, 295 bos, 376 bos, 511 context', 'ten stories at temperature 0.8, topK 40');
	const greedy = model.generate([1]);
	equal((model.decode(greedy).length / (greedy.length - 1)).toFixed(2), '2.25', 'characters per token of the greedy story');
	equal(model.decode(model.generate(model.encode('The stock market fell'), { maxNew: 18 })), 'The stock market fell on the ground. It was a big, red ball.', 'out of its depth');
});

test('README: the patching example, "Lily went to the park." against "Tim went to the park."', () => {
	const she = model.vocab.indexOf(' She'), he = model.vocab.indexOf(' He');
	const A = model.encode('Lily went to the park.'), B = model.encode('Tim went to the park.');
	equal(A.length, 10, 'tokens in A');
	equal(B.length, 10, 'tokens in B');
	const pA = LLM.softmax(model.run(A, { keep: ['logits'] }).logitsAt(9));
	const pB = LLM.softmax(model.run(B, { keep: ['logits'] }).logitsAt(9));
	equal(pA[she].toFixed(2) + ' ' + pA[he].toFixed(2), '0.75 0.03', 'A: p(She) p(He)');
	equal(pB[she].toFixed(2) + ' ' + pB[he].toFixed(2), '0.03 0.71', 'B: p(She) p(He)');
	const rb = model.run(B, { keep: ['resid'] });
	const rows = {};
	for (const pos of [1, 5, 9]) {
		rows[pos] = [];
		for (let i = 0; i <= c.layers; i++) {
			const out = model.run(A, { edits: { type: 'patch', layer: i, pos: pos, from: rb.residAt(i, pos) }, keep: ['logits'] });
			rows[pos].push(LLM.softmax(out.logitsAt(9))[he].toFixed(2));
		}
	}
	equal(rows[1].join(', '), '0.71, 0.71, 0.70, 0.60, 0.61, 0.03', 'patching the name');
	equal(rows[5].join(', '), '0.03, 0.03, 0.03, 0.03, 0.03, 0.03', 'patching " the"');
	equal(rows[9].join(', '), '0.03, 0.03, 0.04, 0.09, 0.10, 0.71', 'patching the full stop');
	return 'p(" He") after patching the name at stations 0..5: ' + rows[1].join(', ');
});

test('README: the steering, ablation and unitWrites examples', () => {
	const lily = model.vocab.indexOf(' Lily');
	const row = model.weights.tokEmb.subarray(lily * c.dim, (lily + 1) * c.dim);
	equal(vectorLength(row).toFixed(2), '1.92', 'length of the row of " Lily"');
	let shortest = Infinity, longest = 0;
	for (let v = 0; v < c.vocab; v++) {
		const n = vectorLength(model.weights.tokEmb.subarray(v * c.dim, (v + 1) * c.dim));
		shortest = Math.min(shortest, n);
		longest = Math.max(longest, n);
	}
	equal(shortest.toFixed(1) + ' to ' + longest.toFixed(1), '1.4 to 3.2', 'lengths of the rows of the table');
	const prompt = model.encode('Once upon a time');
	const steer = (alpha) => model.decode(model.generate(prompt, { maxNew: 24, edits: { type: 'steer', layer: 3, vec: row, alpha: alpha } }));
	equal(steer(1), 'Once upon a time, there was a little girl named Lily. She loved to play with her dolls. She lo', 'alpha 1');
	equal(steer(2), 'Once upon a time, there was a little girl named Lily Lily Lily Lily Lily Lily Lily Lily Lily Lily was a she she lo', 'alpha 2');
	equal(steer(4), 'Once upon a time' + ' Lily'.repeat(24), 'alpha 4');
	equal(model.decode(model.generate(prompt, { maxNew: 40 })),
		'Once upon a time, there was a little girl named Lily. She loved to play outside in the park. One day, she saw a big, red ball.', 'untouched');
	equal(model.decode(model.generate(prompt, { maxNew: 40, edits: { type: 'ablate', layer: 0, unit: 66 } })),
		'Once upon a time, there was a little girl named Lily. She loved to play with her toys and her friends. One day, Lily\'s mommy told her that they we', 'without L0 U66');
	const uw = model.unitWrites(4, 96, 5);
	equal(uw.down.map((e) => e.token).join('|'), ' She| her| she|ily| Lily', 'what L4 U96 pushes down');
	equal(uw.down[0].value.toFixed(2), '-2.18');
	equal(model.decode(model.generate(prompt, { temperature: 0.8, topK: 40, seed: 'lily', maxNew: 60 })),
		'Once upon a time, there was a little girl named Lily. She loved to play with her toys and go on factals. One day, Lily found a ball with a small doll in her backyard. She',
		'the sample in the first code block');
});

test('copy() gives an independent model, and loss() is the sweep\'s baseline loss', () => {
	const twin = model.copy();
	assert(twin.weights.w2.buffer !== model.weights.w2.buffer, 'the copy shares its weights with the original');
	assert(twin.weights.wcls === twin.weights.tokEmb, 'the copy lost the tie between embedding and output');
	equal(maxDiff(twin.run(ids, { keep: ['logits'] }).logits, base.logits), 0, 'an unchanged copy computes the same');
	const before = model.weights.w2[12345];
	twin.weights.w2.fill(0, 4 * c.dim * c.hidden);            // silence the last block's feed-forward part
	equal(model.weights.w2[12345], before, 'the original changed');
	assert(maxDiff(twin.run(ids, { keep: ['logits'] }).logits, base.logits) > 0.1, 'the changed copy still computes the same');
	equal(maxDiff(model.run(ids, { keep: ['logits'] }).logits, base.logits), 0, 'the original is untouched');
	const zeroed = [];
	for (let u = 0; u < c.hidden; u++) zeroed.push({ type: 'ablate', layer: 4, unit: u });
	assert(maxDiff(twin.run(ids, { keep: ['logits'] }).logits, model.run(ids, { edits: zeroed, keep: ['logits'] }).logits) < 1e-5, 'zeroing w2 of a block is ablating all its units');

	const direct = model.loss(ids);
	assert(Math.abs(direct - model.sweep(ids, []).base.loss) < 1e-9, 'loss() and the sweep baseline differ');
	const e = [{ type: 'ablate', layer: 0, unit: 66 }];
	assert(Math.abs(model.loss(ids, { edits: e }) - model.sweep(ids, [e]).loss[0]) < 1e-6, 'loss() with edits and the sweep differ');
	equal(Number.isNaN(model.loss([1])), true, 'one token');
	return 'loss of the test sentence ' + direct.toFixed(3) + ' nats per token';
});

test('README: rounding and culling a copy of the weights', () => {
	const MATS = ['tokEmb', 'wq', 'wk', 'wv', 'wo', 'w1', 'w2', 'w3'];
	function rounded(bits) {
		const m = model.copy();
		MATS.forEach((name) => {
			const w = m.weights[name], levels = Math.pow(2, bits - 1) - 1;
			let max = 0, i;
			for (i = 0; i < w.length; i++) max = Math.max(max, Math.abs(w[i]));
			for (i = 0; i < w.length; i++) w[i] = Math.round(w[i] / max * levels) / levels * max;
		});
		return m;
	}
	function culled(share) {
		const m = model.copy();
		MATS.forEach((name) => {
			const w = m.weights[name], sizes = Float32Array.from(w, Math.abs).sort();
			const cut = sizes[Math.floor(share * (sizes.length - 1))];
			for (let i = 0; i < w.length; i++) if (Math.abs(w[i]) <= cut) w[i] = 0;
		});
		return m;
	}
	const story = model.generate([1], { temperature: 0.8, topK: 40, seed: 1, maxNew: 200 });
	const prompt = model.encode('Once upon a time');
	const row = (m) => m.loss(story).toFixed(2) + ' ' + m.decode(m.generate(prompt, { maxNew: 20 }));
	const same = 'Once upon a time, there was a little girl named Lily. She loved to play outsid';
	equal(story.length, 201, 'tokens in the story');
	equal(row(model), '0.99 ' + same, 'original');
	equal(row(rounded(8)), '1.00 ' + same, '8 bits');
	equal(row(rounded(6)), '1.11 ' + same, '6 bits');
	equal(row(rounded(5)), '1.46 Once upon a time, there was a little boy named Timmy. Timmy loved two friends,', '5 bits');
	equal(row(rounded(4)), '4.13 Once upon a time, there antar named Tlrrromierld. Therevz', '4 bits');
	equal(row(culled(0.2)), '1.05 ' + same, 'smallest 20% zeroed');
	equal(row(culled(0.4)), '2.69 Once upon a time, there was a little giroodob. It lived a myst', 'smallest 40% zeroed');
	equal(culled(0.6).loss(story).toFixed(2), '6.15', 'smallest 60% zeroed');
	equal(row(model), '0.99 ' + same, 'the original afterwards');
});

// --------------------------------------------------------------------- speed

test('speed: 100 tokens, greedy, with the key-value cache', () => {
	let best = Infinity;
	for (let rep = 0; rep < 5; rep++) {
		const t0 = performance.now();
		const out = model.generate([1], { maxNew: 100 });
		best = Math.min(best, performance.now() - t0);
		equal(out.length, 101);
	}
	const rate = 100 / best * 1000;
	assert(rate > 20, 'only ' + rate.toFixed(0) + ' tokens a second');
	const t1 = performance.now();
	model.run(goldenIds.slice(0, 100));
	const runMs = performance.now() - t1;
	return '100 tokens in ' + best.toFixed(1) + ' ms = ' + rate.toFixed(0) + ' tokens/s (best of 5); one full run of 100 tokens keeping everything: ' + runMs.toFixed(1) + ' ms';
});

// ----------------------------------------------------- the worker's protocol

function ask(host, msg, onEvent) {
	return new Promise((resolve) => {
		const events = [];
		host.handle(msg, (reply) => {
			if (reply.id !== msg.id) return;
			if (reply.event) {
				events.push(reply);
				if (onEvent) onEvent(reply);
			} else {
				resolve({ reply: reply, events: events });
			}
		});
	});
}

async function hostTests() {
	const host = LLM.host();

	await testAsync('host: nothing works before "load"; "load" takes the two files', async () => {
		const early = await ask(host, { id: 1, cmd: 'run', args: { ids: [1] } });
		equal(early.reply.ok, false);
		assert(/no model/.test(early.reply.error), early.reply.error);
		const ab = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
		const tb = tokBuf.buffer.slice(tokBuf.byteOffset, tokBuf.byteOffset + tokBuf.byteLength);
		const { reply } = await ask(host, { id: 2, cmd: 'load', args: { bin: ab, tok: tb } });
		equal(reply.ok, true);
		equal(reply.result.config.hidden, 172);
		equal(reply.result.params, 260032);
	});

	await testAsync('host: "run" answers with arrays that survive a structured clone and wrap back into a run', async () => {
		const { reply } = await ask(host, { id: 3, cmd: 'run', args: { ids: ids, opts: { edits: [{ type: 'ablate', layer: 0, unit: 66 }] } } });
		equal(reply.ok, true);
		const clone = structuredClone(reply.result);
		const run = LLM.wrap(clone);
		const direct = model.run(ids, { edits: [{ type: 'ablate', layer: 0, unit: 66 }] });
		equal(maxDiff(run.logits, direct.logits), 0, 'logits');
		equal(maxDiff(run.attnAt(4, 7, T - 1), direct.attnAt(4, 7, T - 1)), 0, 'attention through the accessor');
		equal(JSON.stringify(run.shape), JSON.stringify(direct.shape), 'shape');
	});

	await testAsync('host: "generate" streams the golden text in batches and answers with the ids', async () => {
		const { reply, events } = await ask(host, { id: 4, cmd: 'generate', args: { ids: [1], opts: { maxNew: 256, temperature: 0 } } });
		equal(reply.ok, true);
		equal(reply.result.reason, 'length');
		equal(reply.result.ids.join(','), goldenIds.join(','), 'ids');
		let text = '', n = 0;
		for (const e of events) {
			equal(e.event, 'tokens');
			equal(e.pos, n + 1, 'position of a batch');
			text += e.texts.join('');
			n += e.ids.length;
		}
		equal(text, GOLDEN, 'streamed text');
		equal(n, 256, 'streamed tokens');
		return events.length + ' batches';
	});

	await testAsync('host: "cancel" stops a generation part-way and it answers with what it has', async () => {
		let sent = false;
		const { reply } = await ask(host, { id: 5, cmd: 'generate', args: { ids: [1], opts: { maxNew: 500, temperature: 0.8, topK: 40, seed: 4, stopAtBos: false } } }, () => {
			if (sent) return;
			sent = true;
			host.handle({ id: 6, cmd: 'cancel', args: { target: 5 } }, () => {});
		});
		equal(reply.ok, true);
		equal(reply.result.reason, 'cancelled');
		assert(reply.result.ids.length > 1 && reply.result.ids.length < 501, 'ids after cancel: ' + reply.result.ids.length);
		const whole = model.generate([1], { maxNew: 500, temperature: 0.8, topK: 40, seed: 4, stopAtBos: false });
		equal(reply.result.ids.join(','), whole.slice(0, reply.result.ids.length).join(','), 'the part is the start of the whole');
		return 'stopped after ' + (reply.result.ids.length - 1) + ' of 500 tokens';
	});

	await testAsync('host: "sweep" reports progress with the new results and answers like model.sweep', async () => {
		const sets = [];
		for (let u = 0; u < 60; u++) sets.push({ type: 'ablate', layer: 1, unit: u });
		const { reply, events } = await ask(host, { id: 7, cmd: 'sweep', args: { ids: ids, editSets: sets, opts: {} } });
		equal(reply.ok, true);
		const direct = model.sweep(ids, sets);
		equal(reply.result.cancelled, false);
		equal(reply.result.done, sets.length);
		equal(maxDiff(reply.result.kl, direct.kl), 0, 'kl');
		equal(maxDiff(reply.result.loss, direct.loss), 0, 'loss');
		equal(maxDiff(reply.result.base.logits, direct.base.logits), 0, 'baseline logits');
		const seenKl = [];
		let done = 0;
		for (const e of events) {
			equal(e.event, 'progress');
			equal(e.total, sets.length);
			equal(e.from, done, 'parts follow one another');
			for (const v of e.kl) seenKl.push(v);
			done = e.done;
		}
		equal(done, sets.length, 'the last progress event covers the end');
		equal(maxDiff(Float32Array.from(seenKl), direct.kl), 0, 'the parts add up to the whole');
		return events.length + ' progress events for ' + sets.length + ' edit sets';
	});

	await testAsync('host: a cancelled sweep answers with the part that was done', async () => {
		const sets = [];
		for (let l = 0; l < c.layers; l++) for (let u = 0; u < c.hidden; u++) sets.push({ type: 'ablate', layer: l, unit: u });
		let sent = false;
		const { reply } = await ask(host, { id: 8, cmd: 'sweep', args: { ids: ids, editSets: sets, opts: {} } }, () => {
			if (sent) return;
			sent = true;
			host.handle({ id: 9, cmd: 'cancel', args: { target: 8 } }, () => {});
		});
		equal(reply.ok, true);
		equal(reply.result.cancelled, true);
		assert(reply.result.done > 0 && reply.result.done < sets.length, 'done: ' + reply.result.done);
		return 'stopped after ' + reply.result.done + ' of ' + sets.length;
	});

	await testAsync('host: mistakes come back as { ok: false, error } and the small commands work', async () => {
		const bad = await ask(host, { id: 10, cmd: 'run', args: { ids: ids, opts: { edits: [{ type: 'ablate', layer: 0, unit: 999 }] } } });
		equal(bad.reply.ok, false);
		assert(/unit 999/.test(bad.reply.error), bad.reply.error);
		const badGen = await ask(host, { id: 11, cmd: 'generate', args: { ids: [], opts: {} } });
		equal(badGen.reply.ok, false);
		const badSweep = await ask(host, { id: 12, cmd: 'sweep', args: { ids: ids, editSets: 'x', opts: {} } });
		equal(badSweep.reply.ok, false);
		const unknown = await ask(host, { id: 13, cmd: 'dance', args: {} });
		assert(/unknown command "dance"/.test(unknown.reply.error), unknown.reply.error);
		const enc = await ask(host, { id: 14, cmd: 'encode', args: { text: 'the park' } });
		equal(enc.reply.result.join(','), model.encode('the park').join(','));
		const dec = await ask(host, { id: 15, cmd: 'decode', args: { ids: enc.reply.result } });
		equal(dec.reply.result, 'the park');
		const lens = await ask(host, { id: 16, cmd: 'lens', args: { vec: Array.from(base.residAt(5, T - 1)), k: 3 } });
		equal(lens.reply.result[0].id, argmax(base.logitsAt(T - 1)));
		const uw = await ask(host, { id: 17, cmd: 'unitWrites', args: { layer: 4, unit: 10, k: 2 } });
		equal(uw.reply.result.up[0].id, model.unitWrites(4, 10, 2).up[0].id);
		const nothing = await ask(host, { id: 18, cmd: 'cancel', args: { target: 12345 } });
		equal(nothing.reply.result, false, 'cancelling a job that is not there');
	});
}

hostTests().then(() => {
	console.log('');
	console.log(failures ? failures + ' of ' + count + ' checks FAILED' : 'All ' + count + ' checks passed.');
	process.exitCode = failures ? 1 : 0;
}, (err) => {
	console.log('FAIL the test run itself broke  (' + (err && err.stack ? err.stack : err) + ')');
	process.exitCode = 1;
});
