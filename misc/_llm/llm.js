/* misc/_llm/llm.js
 *
 * A language model small enough to run in a web page, with every internal value
 * handed back to the caller: the residual stream, each feed-forward unit's
 * activation, each attention weight, and edits to all of them.
 *
 * The weights are "stories260K" by Andrej Karpathy (MIT): a Llama-2-shaped
 * transformer of about 260,000 parameters, trained on TinyStories. The file
 * layout and the arithmetic follow run.c of his llama2.c (MIT); see LICENSES.md.
 *
 * Nothing here touches the DOM or the network. LLM.load() takes the two files
 * as ArrayBuffers. README.md is the manual; test.js is the proof.
 *
 * Old-style on purpose (var, function, one closure): the same file runs as a
 * page script, inside a Web Worker and under Node.
 */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module && module.exports) module.exports = api;
	// a page (window.LLM) or a worker (self.LLM); under Node only the export above
	if (root && (root.document || typeof root.importScripts === 'function')) root.LLM = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
	'use strict';

	var UNK = 0, BOS = 1, EOS = 2;
	var BYTE_BASE = 3;          // ids 3..258 are the 256 raw bytes, in order
	var HEADER_BYTES = 28;      // seven int32
	var SLICE_MS = 12;          // how long a job in LLM.host() works before it lets other things run
	var REPLACEMENT = String.fromCharCode(0xFFFD);

	var LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

	function fail(message) {
		throw new Error('LLM: ' + message);
	}

	function tagOf(v) {
		return Object.prototype.toString.call(v);
	}

	// An ArrayBuffer, or any view on one (Uint8Array, a Node Buffer, a DataView), as bytes.
	function asBytes(input, what) {
		if (tagOf(input) === '[object ArrayBuffer]') return new Uint8Array(input);
		if (input && tagOf(input.buffer) === '[object ArrayBuffer]' && typeof input.byteLength === 'number') {
			return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
		}
		return fail(what + ' must be an ArrayBuffer or a typed array');
	}

	function intIn(v, lo, hi) {
		return typeof v === 'number' && v === Math.floor(v) && v >= lo && v <= hi;
	}

	function now() {
		return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
	}

	// ------------------------------------------------------------------ UTF-8

	function utf8Encode(str) {
		var out = [], i, c, d;
		for (i = 0; i < str.length; i++) {
			c = str.charCodeAt(i);
			if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
				d = str.charCodeAt(i + 1);
				if (d >= 0xDC00 && d <= 0xDFFF) {
					c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00);
					i++;
				}
			}
			if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;      // half of a surrogate pair on its own
			if (c < 0x80) out.push(c);
			else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
			else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
			else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
		}
		return out;
	}

	// Bytes in, text out, a piece at a time: a character split over two tokens
	// comes out when its last byte arrives.
	function Utf8Stream() {
		this.need = 0;      // continuation bytes still expected
		this.cp = 0;
		this.min = 0;       // smallest code point this length may encode
	}

	function fromCodePoint(cp) {
		if (cp < 0x10000) return String.fromCharCode(cp);
		cp -= 0x10000;
		return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
	}

	Utf8Stream.prototype.push = function (bytes, start) {
		var out = '', i, b;
		for (i = start || 0; i < bytes.length; i++) {
			b = bytes[i];
			if (this.need) {
				if ((b & 0xC0) === 0x80) {
					this.cp = (this.cp << 6) | (b & 0x3F);
					if (--this.need === 0) {
						out += (this.cp >= this.min && this.cp <= 0x10FFFF && !(this.cp >= 0xD800 && this.cp <= 0xDFFF))
							? fromCodePoint(this.cp) : REPLACEMENT;
					}
					continue;
				}
				out += REPLACEMENT;     // the character broke off; this byte starts afresh
				this.need = 0;
			}
			if (b < 0x80) out += String.fromCharCode(b);
			else if (b >= 0xC2 && b <= 0xDF) { this.need = 1; this.cp = b & 0x1F; this.min = 0x80; }
			else if (b >= 0xE0 && b <= 0xEF) { this.need = 2; this.cp = b & 0x0F; this.min = 0x800; }
			else if (b >= 0xF0 && b <= 0xF4) { this.need = 3; this.cp = b & 0x07; this.min = 0x10000; }
			else out += REPLACEMENT;    // a stray continuation byte, or a byte UTF-8 never uses
		}
		return out;
	};

	Utf8Stream.prototype.end = function () {
		if (!this.need) return '';
		this.need = 0;
		return REPLACEMENT;
	};

	function utf8Decode(bytes) {
		var s = new Utf8Stream();
		return s.push(bytes, 0) + s.end();
	}

	// -------------------------------------------------------------- tokenizer
	//
	// The file: uint32 longest piece, then per token float32 score, int32 length,
	// bytes. Ids 0, 1, 2 are <unk>, <s> (start) and </s>; 3..258 are the raw
	// bytes, spelled "<0x00>" to "<0xFF>"; the rest are learned pieces, where a
	// leading space marks the start of a word.

	function Tokenizer(input, vocabSize) {
		var bytes = asBytes(input, 'the tokenizer file');
		var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		var off = 4, i, j, len, piece, raw, m;
		if (bytes.byteLength < 4) fail('the tokenizer file is empty');
		this.size = vocabSize;
		this.maxTokenLength = dv.getUint32(0, true);
		this.scores = new Float32Array(vocabSize);
		this.raw = new Array(vocabSize);        // the piece as stored, one character per byte: the lookup key
		this.bytes = new Array(vocabSize);      // what decode() emits for the id
		this.vocab = new Array(vocabSize);      // the piece as text, for people
		this.lookup = Object.create(null);
		this.pairs = null;                      // filled as pairs are met, see mergeOf()
		for (i = 0; i < vocabSize; i++) {
			if (off + 8 > bytes.byteLength) fail('the tokenizer file ends after ' + i + ' of ' + vocabSize + ' tokens');
			this.scores[i] = dv.getFloat32(off, true);
			len = dv.getInt32(off + 4, true);
			off += 8;
			if (len < 0 || off + len > bytes.byteLength) fail('the tokenizer file is damaged at token ' + i);
			piece = new Uint8Array(bytes.subarray(off, off + len));
			off += len;
			raw = '';
			for (j = 0; j < len; j++) raw += String.fromCharCode(piece[j]);
			this.raw[i] = raw;
			if (this.lookup[raw] === undefined) this.lookup[raw] = i;
			m = /^<0x([0-9A-Fa-f]{2})>$/.exec(raw);
			if (i <= EOS) {
				this.bytes[i] = new Uint8Array(0);                      // the three specials are not text
				this.vocab[i] = raw.replace(/^\s+|\s+$/g, '');      // stored as "\n<s>\n"
			} else if (m) {
				this.bytes[i] = new Uint8Array([parseInt(m[1], 16)]);
				this.vocab[i] = raw;
			} else {
				this.bytes[i] = piece;
				this.vocab[i] = utf8Decode(piece);
			}
		}
		if (off !== bytes.byteLength) {
			fail('the tokenizer file has ' + (bytes.byteLength - off) + ' bytes left over after ' + vocabSize + ' tokens');
		}
		for (i = 0; i < 256; i++) {
			// encode() spells an unknown byte b as id 3 + b, so those ids must be the byte tokens
			m = /^<0x([0-9A-Fa-f]{2})>$/.exec(this.raw[BYTE_BASE + i] || '');
			if (!m || parseInt(m[1], 16) !== i) fail('this tokenizer does not keep its 256 byte tokens at ids 3 to 258');
		}
		if (this.lookup[' '] === undefined) fail('this tokenizer has no piece for a single space');
		this.spaceId = this.lookup[' '];
	}

	// The id of the piece that two neighbouring tokens spell together, or -1.
	// Remembered in a table: 0 not looked up yet, 1 no such piece, id + 2.
	function mergeOf(tk, a, b) {
		var key = a * tk.size + b, got = tk.pairs[key], id;
		if (got === 0) {
			id = tk.lookup[tk.raw[a] + tk.raw[b]];
			got = id === undefined ? 1 : id + 2;
			tk.pairs[key] = got;
		}
		return got - 2;
	}

	// run.c's encode(): the start token, a space in front of the text, one token
	// per character (unknown characters as their bytes), then merge the
	// neighbouring pair whose joined piece has the best score, leftmost first
	// among equals, until no pair spells a piece.
	Tokenizer.prototype.encode = function (text, opts) {
		var bytes = utf8Encode(String(text == null ? '' : text));
		var n = bytes.length, toks = [], scores = this.scores;
		var i, j, c, next, buf = '', len = 0, id, best, bestId, bestAt, count;
		opts = checkOptions(opts, ENCODE_KEYS, 'encode') || {};
		if (opts.bos !== false) toks.push(BOS);
		if (n > 0) toks.push(this.spaceId);
		for (i = 0; i < n; i++) {
			c = bytes[i];
			if ((c & 0xC0) !== 0x80) { buf = ''; len = 0; }       // not a continuation byte: a new character
			buf += String.fromCharCode(c);
			len++;
			next = i + 1 < n ? bytes[i + 1] : 0;
			if ((next & 0xC0) === 0x80 && len < 4) continue;      // the character has more bytes
			id = this.lookup[buf];
			if (id !== undefined) toks.push(id);
			else for (j = 0; j < len; j++) toks.push(buf.charCodeAt(j) + BYTE_BASE);
			buf = '';
			len = 0;
		}
		if (!this.pairs) this.pairs = new Int16Array(this.size * this.size);
		count = toks.length;
		for (;;) {
			best = -1e10;
			bestId = -1;
			bestAt = -1;
			for (i = 0; i < count - 1; i++) {
				id = mergeOf(this, toks[i], toks[i + 1]);
				if (id >= 0 && scores[id] > best) {
					best = scores[id];
					bestId = id;
					bestAt = i;
				}
			}
			if (bestAt < 0) break;
			toks[bestAt] = bestId;
			toks.splice(bestAt + 1, 1);
			count--;
		}
		if (opts.eos) toks.push(EOS);
		return toks;
	};

	// Text out of ids, one id at a time. The three specials give no text, and
	// the piece right after the start token loses its leading space (run.c does
	// the same: that space was put there by encode()).
	function Decoder(tk) {
		this.tk = tk;
		this.utf8 = new Utf8Stream();
		this.afterBos = false;
	}

	Decoder.prototype.push = function (id) {
		var b = this.tk.bytes[id], start;
		if (!b) fail('token id ' + id + ' is not in the vocabulary (0..' + (this.tk.size - 1) + ')');
		if (id === BOS) { this.afterBos = true; return ''; }
		start = (this.afterBos && b.length && b[0] === 0x20) ? 1 : 0;
		this.afterBos = false;
		return b.length ? this.utf8.push(b, start) : '';
	};

	Decoder.prototype.end = function () {
		return this.utf8.end();
	};

	Tokenizer.prototype.decoder = function () {
		return new Decoder(this);
	};

	Tokenizer.prototype.decode = function (ids) {
		var d = new Decoder(this), out = '', i;
		if (ids == null || typeof ids.length !== 'number') ids = [ids];
		for (i = 0; i < ids.length; i++) out += d.push(ids[i]);
		return out + d.end();
	};

	// ---------------------------------------------------------------- kernels

	// out[oo + i] = the sum over j of W[wo + i * nIn + j] * x[xo + j]: one matrix row per output.
	function matvec(out, oo, W, wo, x, xo, nIn, nOut) {
		var i, j, sum, row;
		for (i = 0; i < nOut; i++) {
			sum = 0;
			row = wo + i * nIn;
			for (j = 0; j < nIn; j++) sum += W[row + j] * x[xo + j];
			out[oo + i] = sum;
		}
	}

	// RMSNorm: divide by the root of the mean square, then multiply by a learned gain per dimension.
	function rmsnorm(out, oo, x, xo, gain, go, n) {
		var ss = 0, j, v;
		for (j = 0; j < n; j++) { v = x[xo + j]; ss += v * v; }
		ss = 1 / Math.sqrt(ss / n + 1e-5);
		for (j = 0; j < n; j++) out[oo + j] = gain[go + j] * (ss * x[xo + j]);
	}

	// ------------------------------------------------------------------ model

	function floatsOf(bytes, byteStart, count) {
		var off = bytes.byteOffset + byteStart, out, dv, i;
		if (LITTLE_ENDIAN && off % 4 === 0) return new Float32Array(bytes.buffer, off, count);
		out = new Float32Array(count);
		dv = new DataView(bytes.buffer, off, count * 4);
		for (i = 0; i < count; i++) out[i] = dv.getFloat32(i * 4, true);
		return out;
	}

	function load(binInput, tokInput) {
		var bytes = asBytes(binInput, 'the checkpoint');
		var dv, c, shared, vocabField, headSize, kvDim, sizes, names, total, i, floats, w, at, model;
		if (bytes.byteLength < HEADER_BYTES) fail('the checkpoint is too short to hold its header');
		dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		vocabField = dv.getInt32(20, true);
		shared = vocabField > 0;                // a negative vocabulary size means a separate output matrix
		c = {
			dim: dv.getInt32(0, true),
			hidden: dv.getInt32(4, true),
			layers: dv.getInt32(8, true),
			heads: dv.getInt32(12, true),
			kvHeads: dv.getInt32(16, true),
			vocab: Math.abs(vocabField),
			seqLen: dv.getInt32(24, true)
		};
		for (i in c) {
			if (!(c[i] > 0 && c[i] < 1e6)) fail('the checkpoint header is not a llama2.c header (' + i + ' = ' + c[i] + ')');
		}
		if (c.dim % c.heads || c.heads % c.kvHeads) fail('the checkpoint header has heads that do not divide evenly');
		headSize = c.dim / c.heads;
		if (headSize % 2) fail('the head size must be even for the rotary position encoding');
		kvDim = headSize * c.kvHeads;
		names = ['tokEmb', 'rmsAtt', 'wq', 'wk', 'wv', 'wo', 'rmsFfn', 'w1', 'w2', 'w3', 'rmsFinal', 'ropeCosFile', 'ropeSinFile'];
		sizes = [
			c.vocab * c.dim,                    // tokEmb    [vocab][dim]
			c.layers * c.dim,                   // rmsAtt    [layers][dim]
			c.layers * c.dim * c.dim,           // wq        [layers][dim][dim]
			c.layers * kvDim * c.dim,           // wk        [layers][kvDim][dim]
			c.layers * kvDim * c.dim,           // wv        [layers][kvDim][dim]
			c.layers * c.dim * c.dim,           // wo        [layers][dim][dim]
			c.layers * c.dim,                   // rmsFfn    [layers][dim]
			c.layers * c.hidden * c.dim,        // w1        [layers][hidden][dim]
			c.layers * c.dim * c.hidden,        // w2        [layers][dim][hidden]
			c.layers * c.hidden * c.dim,        // w3        [layers][hidden][dim]
			c.dim,                              // rmsFinal  [dim]
			c.seqLen * headSize / 2,            // rotation tables the file still carries; run.c skips them
			c.seqLen * headSize / 2
		];
		if (!shared) { names.push('wcls'); sizes.push(c.vocab * c.dim); }
		total = 0;
		for (i = 0; i < sizes.length; i++) total += sizes[i];
		if (bytes.byteLength !== HEADER_BYTES + total * 4) {
			fail('the checkpoint has ' + bytes.byteLength + ' bytes; its header describes a model of ' + (HEADER_BYTES + total * 4));
		}
		floats = floatsOf(bytes, HEADER_BYTES, total);
		w = {};
		at = 0;
		for (i = 0; i < sizes.length; i++) {
			w[names[i]] = floats.subarray(at, at + sizes[i]);
			at += sizes[i];
		}
		if (shared) w.wcls = w.tokEmb;          // the output matrix is the embedding table
		model = new Model(c, w, new Tokenizer(tokInput, c.vocab), shared);
		model.files = { bin: bytes, tok: asBytes(tokInput, 'the tokenizer file') };     // for copy()
		return model;
	}

	function Model(config, weights, tokenizer, tied) {
		var c = config, headSize = c.dim / c.heads, half = headSize / 2, p, j, freq, val;
		this.config = c;
		this.weights = weights;
		this.tokenizer = tokenizer;
		this.vocab = tokenizer.vocab;
		this.tied = tied;
		this.headSize = headSize;
		this.kvDim = headSize * c.kvHeads;
		this.kvMul = c.heads / c.kvHeads;       // how many query heads share one key/value head
		this.params = weights.tokEmb.length + weights.rmsAtt.length + weights.wq.length + weights.wk.length +
			weights.wv.length + weights.wo.length + weights.rmsFfn.length + weights.w1.length + weights.w2.length +
			weights.w3.length + weights.rmsFinal.length + (tied ? 0 : weights.wcls.length);
		// The rotation of position p in the j-th pair of a head: angle p / 10000^(2j / headSize),
		// rounded to single precision where run.c rounds.
		this.ropeCos = new Float32Array(c.seqLen * half);
		this.ropeSin = new Float32Array(c.seqLen * half);
		for (p = 0; p < c.seqLen; p++) {
			for (j = 0; j < half; j++) {
				freq = Math.fround(1 / Math.fround(Math.pow(10000, Math.fround(2 * j / headSize))));
				val = Math.fround(p * freq);
				this.ropeCos[p * half + j] = Math.cos(val);
				this.ropeSin[p * half + j] = Math.sin(val);
			}
		}
		this.scratch = {
			xb: new Float32Array(c.dim),
			xb2: new Float32Array(c.dim),
			q: new Float32Array(c.dim),
			hb: new Float32Array(c.hidden),
			hb2: new Float32Array(c.hidden),
			att: new Float32Array(c.seqLen),
			logits: new Float32Array(c.vocab)
		};
	}

	// A second model with its own copy of the weights. Writing to copy.weights
	// (rounding them to fewer levels, zeroing the smallest) changes the copy
	// and nothing else.
	Model.prototype.copy = function () {
		return load(new Uint8Array(this.files.bin), new Uint8Array(this.files.tok));
	};

	Model.prototype.encode = function (text, opts) {
		return this.tokenizer.encode(text, opts);
	};

	Model.prototype.decode = function (ids) {
		return this.tokenizer.decode(ids);
	};

	// The number of ids, after checking that the model can take them.
	function checkIds(m, ids) {
		var c = m.config, n, i;
		if (!ids || typeof ids === 'string' || typeof ids.length !== 'number') fail('the token ids must be an array (use model.encode(text))');
		n = ids.length;
		if (n < 1) fail('there are no token ids; a sequence starts with the start token, id 1');
		if (n > c.seqLen) fail('there are ' + n + ' tokens; the context holds ' + c.seqLen);
		for (i = 0; i < n; i++) {
			if (!intIn(ids[i], 0, c.vocab - 1)) fail('token ' + i + ' is ' + ids[i] + '; ids run from 0 to ' + (c.vocab - 1));
		}
		return n;
	}

	// ------------------------------------------------------------------ edits

	function listOf(edits) {
		return edits == null ? [] : (Array.isArray(edits) ? edits : [edits]);
	}

	function vecOf(v, dim, what) {
		var out, i;
		if (!v || typeof v === 'string' || typeof v.length !== 'number') fail(what + ' must be an array of ' + dim + ' numbers');
		if (v.length !== dim) fail(what + ' has ' + v.length + ' numbers; it needs ' + dim);
		out = new Float32Array(dim);
		for (i = 0; i < dim; i++) {
			out[i] = v[i];
			if (!isFinite(out[i])) fail(what + ' holds something that is not a finite number at index ' + i);
		}
		return out;
	}

	function numOf(v, fallback, what) {
		if (v == null) return fallback;
		if (typeof v !== 'number' || !isFinite(v)) fail(what + ' must be a finite number');
		return v;
	}

	// A misspelt option would otherwise be ignored without a word (pos written
	// as position ablates every position), so every options object and every
	// edit may hold only the names it is known to take.
	function checkOptions(opts, names, where) {
		var k;
		if (opts == null) return opts;
		if (typeof opts !== 'object' || Array.isArray(opts)) fail(where + ': the options must be an object such as { ' + names[0] + ': ... }');
		for (k in opts) {
			if (Object.prototype.hasOwnProperty.call(opts, k) && names.indexOf(k) < 0) {
				fail(where + ': unknown option "' + k + '" (known: ' + names.join(', ') + ')');
			}
		}
		return opts;
	}

	var EDIT_KEYS = {
		ablate: ['type', 'layer', 'unit', 'value', 'pos'],
		head: ['type', 'layer', 'head', 'scale', 'pos'],
		steer: ['type', 'layer', 'vec', 'alpha', 'pos'],
		patch: ['type', 'layer', 'pos', 'from']
	};
	var RUN_KEYS = ['edits', 'keep'];
	var GENERATE_KEYS = ['maxNew', 'temperature', 'topK', 'seed', 'edits', 'onToken', 'stopAtBos'];
	var SWEEP_KEYS = ['at', 'target', 'loss', 'logits', 'base', 'onProgress'];
	var ENCODE_KEYS = ['bos', 'eos'];

	// Edits sorted by where they act, checked once, so the forward pass only looks at short lists.
	//   mlp[l], head[l]    by block
	//   station[i]         by index into resid: 0 after the embedding, i after i blocks
	//   firstLayer         the first block whose result the edits can change (layers + 1: none)
	//   firstPos           the first position they can change
	function compileEdits(m, edits, limit) {
		var c = m.config, L = c.layers, list = listOf(edits), plan, i, e, where, pos;
		if (!list.length) return null;
		plan = { mlp: new Array(L), head: new Array(L), station: new Array(L + 1), firstLayer: L + 1, firstPos: limit };
		for (i = 0; i < list.length; i++) {
			e = list[i];
			if (!e || typeof e !== 'object') fail('edit ' + i + ' is not an object');
			where = 'edit ' + i + ' (' + e.type + ')';
			if (EDIT_KEYS.hasOwnProperty(e.type)) checkOptions(e, EDIT_KEYS[e.type], where);
			if (e.pos != null && !intIn(e.pos, 0, limit - 1)) fail(where + ': pos ' + e.pos + ' is out of range 0..' + (limit - 1));
			pos = e.pos == null ? -1 : e.pos;
			if (e.type === 'ablate') {
				if (!intIn(e.layer, 0, L - 1)) fail(where + ': layer ' + e.layer + ' is out of range 0..' + (L - 1));
				if (!intIn(e.unit, 0, c.hidden - 1)) fail(where + ': unit ' + e.unit + ' is out of range 0..' + (c.hidden - 1));
				(plan.mlp[e.layer] || (plan.mlp[e.layer] = [])).push({ unit: e.unit, value: numOf(e.value, 0, where + ': value'), pos: pos });
			} else if (e.type === 'head') {
				if (!intIn(e.layer, 0, L - 1)) fail(where + ': layer ' + e.layer + ' is out of range 0..' + (L - 1));
				if (!intIn(e.head, 0, c.heads - 1)) fail(where + ': head ' + e.head + ' is out of range 0..' + (c.heads - 1));
				(plan.head[e.layer] || (plan.head[e.layer] = [])).push({ head: e.head, scale: numOf(e.scale, 0, where + ': scale'), pos: pos });
			} else if (e.type === 'steer') {
				if (!intIn(e.layer, 0, L)) fail(where + ': layer ' + e.layer + ' is out of range 0..' + L + ' (the first index of resid)');
				(plan.station[e.layer] || (plan.station[e.layer] = [])).push({ patch: false, vec: vecOf(e.vec, c.dim, where + ': vec'), alpha: numOf(e.alpha, 1, where + ': alpha'), pos: pos });
			} else if (e.type === 'patch') {
				if (!intIn(e.layer, 0, L)) fail(where + ': layer ' + e.layer + ' is out of range 0..' + L + ' (the first index of resid)');
				if (pos < 0) fail(where + ': pos is missing; a patch replaces the residual at one position');
				(plan.station[e.layer] || (plan.station[e.layer] = [])).push({ patch: true, vec: vecOf(e.from, c.dim, where + ': from'), alpha: 1, pos: pos });
			} else {
				fail('edit ' + i + ' has the unknown type "' + e.type + '" (known: ablate, steer, patch, head)');
			}
			if (e.layer < plan.firstLayer) plan.firstLayer = e.layer;
			if (Math.max(pos, 0) < plan.firstPos) plan.firstPos = Math.max(pos, 0);
		}
		return plan;
	}

	// The same edits as fresh plain objects whose vectors are small copies, safe to send to a
	// worker (a view such as run.residAt(3, 5) would otherwise drag its whole buffer along).
	function copyEdits(edits) {
		return listOf(edits).map(function (e) {
			var out = {}, k;
			if (!e || typeof e !== 'object') return e;
			for (k in e) {
				if (!Object.prototype.hasOwnProperty.call(e, k)) continue;
				out[k] = (e[k] && typeof e[k] === 'object' && typeof e[k].length === 'number') ? new Float32Array(e[k]) : e[k];
			}
			return out;
		});
	}

	// steer and patch, at one station and one position, in the order they were given.
	function applyStation(plan, station, t, x, xo, dim) {
		var list = plan.station[station], i, d, e;
		if (!list) return;
		for (i = 0; i < list.length; i++) {
			e = list[i];
			if (e.pos >= 0 && e.pos !== t) continue;
			if (e.patch) for (d = 0; d < dim; d++) x[xo + d] = e.vec[d];
			else for (d = 0; d < dim; d++) x[xo + d] += e.alpha * e.vec[d];
		}
	}

	// ----------------------------------------------------------- forward pass

	var NO_REC = { attn: null, mid: null, pre1: null, pre3: null, mlp: null };

	// One block (attention, then feed-forward) at one position, in place.
	//
	//   x[xo .. xo + dim)   the residual of position t going into block l; coming out of it on return
	//   K, V                this block's keys and values: position s lives at ko + s * kvDim.
	//                       Positions before t must already be there; t's are written here.
	//   plan                compiled edits, or null
	//   rec                 where to copy what is seen on the way (NO_REC: nowhere)
	//
	// run() calls it block by block over all positions; a Session calls it for
	// the newest position only, with the earlier keys and values in its cache.
	// That both give the same numbers is one of the tests.
	function blockStep(m, l, t, x, xo, K, V, ko, plan, rec) {
		var c = m.config, w = m.weights, s = m.scratch;
		var dim = c.dim, hidden = c.hidden, heads = c.heads, hs = m.headSize, kvDim = m.kvDim, kvMul = m.kvMul;
		var q = s.q, xb = s.xb, xb2 = s.xb2, hb = s.hb, hb2 = s.hb2, att = s.att;
		var kt = ko + t * kvDim, half = hs / 2, ro = t * half, rc = m.ropeCos, rs = m.ropeSin;
		var root = Math.sqrt(hs);
		var i, j, h, u, a, b, cs, sn, qo, kh, ks, vs, score, max, sum, list, e, v, ao;

		// --- attention: what should this position read from the ones before it?
		rmsnorm(xb, 0, x, xo, w.rmsAtt, l * dim, dim);
		matvec(q, 0, w.wq, l * dim * dim, xb, 0, dim, dim);
		matvec(K, kt, w.wk, l * kvDim * dim, xb, 0, dim, kvDim);
		matvec(V, kt, w.wv, l * kvDim * dim, xb, 0, dim, kvDim);

		// position: rotate each pair of numbers in the query and the key by an angle that grows with t
		for (i = 0; i < dim; i += 2) {
			j = (i % hs) >> 1;
			cs = rc[ro + j];
			sn = rs[ro + j];
			a = q[i]; b = q[i + 1];
			q[i] = a * cs - b * sn;
			q[i + 1] = a * sn + b * cs;
			if (i < kvDim) {
				a = K[kt + i]; b = K[kt + i + 1];
				K[kt + i] = a * cs - b * sn;
				K[kt + i + 1] = a * sn + b * cs;
			}
		}

		for (h = 0; h < heads; h++) {
			qo = h * hs;
			kh = ((h / kvMul) | 0) * hs;        // heads share keys and values in groups of kvMul
			max = -Infinity;
			for (u = 0; u <= t; u++) {
				ks = ko + u * kvDim + kh;
				score = 0;
				for (i = 0; i < hs; i++) score += q[qo + i] * K[ks + i];
				score /= root;
				att[u] = score;
				if (att[u] > max) max = att[u];
			}
			sum = 0;
			for (u = 0; u <= t; u++) {
				att[u] = Math.exp(att[u] - max);
				sum += att[u];
			}
			for (u = 0; u <= t; u++) att[u] /= sum;
			if (rec.attn) {
				ao = rec.attnBase + h * rec.attnStride;
				for (u = 0; u <= t; u++) rec.attn[ao + u] = att[u];
			}
			for (i = 0; i < hs; i++) xb[qo + i] = 0;
			for (u = 0; u <= t; u++) {
				a = att[u];
				vs = ko + u * kvDim + kh;
				for (i = 0; i < hs; i++) xb[qo + i] += a * V[vs + i];
			}
		}

		if (plan && plan.head[l]) {
			list = plan.head[l];
			for (j = 0; j < list.length; j++) {
				e = list[j];
				if (e.pos >= 0 && e.pos !== t) continue;
				qo = e.head * hs;
				for (i = 0; i < hs; i++) xb[qo + i] *= e.scale;
			}
		}

		matvec(xb2, 0, w.wo, l * dim * dim, xb, 0, dim, dim);
		for (i = 0; i < dim; i++) x[xo + i] += xb2[i];
		if (rec.mid) for (i = 0; i < dim; i++) rec.mid[rec.midOff + i] = x[xo + i];

		// --- feed-forward: hidden unit = silu(w1 . x) * (w3 . x), written back through w2
		rmsnorm(xb, 0, x, xo, w.rmsFfn, l * dim, dim);
		matvec(hb, 0, w.w1, l * hidden * dim, xb, 0, dim, hidden);
		matvec(hb2, 0, w.w3, l * hidden * dim, xb, 0, dim, hidden);
		if (rec.pre1) {
			for (i = 0; i < hidden; i++) {
				rec.pre1[rec.preOff + i] = hb[i];
				rec.pre3[rec.preOff + i] = hb2[i];
			}
		}
		for (i = 0; i < hidden; i++) {
			v = hb[i];
			hb[i] = v * (1 / (1 + Math.exp(-v))) * hb2[i];
		}
		ffWrite(m, l, t, x, xo, plan, rec);
	}

	// The end of a block: scratch.hb holds the hidden activations of position t.
	// Apply the edits to them, then write them into the residual through w2.
	// (Apart from blockStep, a sweep enters here when only this part can differ
	// from the baseline.)
	function ffWrite(m, l, t, x, xo, plan, rec) {
		var c = m.config, dim = c.dim, hidden = c.hidden, hb = m.scratch.hb, xb = m.scratch.xb, list, e, i, j;
		if (plan && plan.mlp[l]) {
			list = plan.mlp[l];
			for (j = 0; j < list.length; j++) {
				e = list[j];
				if (e.pos >= 0 && e.pos !== t) continue;
				hb[e.unit] = e.value;
			}
		}
		if (rec.mlp) for (i = 0; i < hidden; i++) rec.mlp[rec.mlpOff + i] = hb[i];
		matvec(xb, 0, m.weights.w2, l * dim * hidden, hb, 0, hidden, dim);
		for (i = 0; i < dim; i++) x[xo + i] += xb[i];
	}

	// The final norm, then one score per token.
	function unembed(m, x, xo, out, oo) {
		var c = m.config;
		rmsnorm(m.scratch.xb, 0, x, xo, m.weights.rmsFinal, 0, c.dim);
		matvec(out, oo, m.weights.wcls, 0, m.scratch.xb, 0, c.dim, c.vocab);
	}

	// -------------------------------------------------------------------- run

	var KEEP_NAMES = ['logits', 'resid', 'mlp', 'attn', 'mid', 'pre'];
	var KEEP_DEFAULT = { logits: true, resid: true, mlp: true, attn: true, mid: false, pre: false };

	function keepOf(keep) {
		var out, list, i;
		if (keep == null) return KEEP_DEFAULT;
		list = typeof keep === 'string' ? keep.split(/[\s,]+/) : keep;
		if (!Array.isArray(list)) fail('keep must be a list of names such as ["logits", "resid"]');
		out = { logits: false, resid: false, mlp: false, attn: false, mid: false, pre: false };
		for (i = 0; i < list.length; i++) {
			if (list[i] === '') continue;
			if (KEEP_NAMES.indexOf(list[i]) < 0) fail('keep: unknown name "' + list[i] + '" (known: ' + KEEP_NAMES.join(', ') + ')');
			out[list[i]] = true;
		}
		return out;
	}

	// What run() returns: flat arrays, their shapes, and accessors that hand out views (no copying).
	function Run(raw) {
		var k;
		for (k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) this[k] = raw[k];
	}

	function rowOf(run, name, index, counts) {
		var arr = run[name], shape = run.shape[name], off = 0, i;
		if (!arr) fail('this run did not keep "' + name + '"');
		for (i = 0; i < counts; i++) {
			if (!intIn(index[i], 0, shape[i] - 1)) fail(name + ': index ' + index[i] + ' is out of range 0..' + (shape[i] - 1));
			off = off * shape[i] + index[i];
		}
		off *= shape[counts];
		return arr.subarray(off, off + shape[counts]);
	}

	Run.prototype.logitsAt = function (t) { return rowOf(this, 'logits', [t], 1); };
	Run.prototype.residAt = function (i, t) { return rowOf(this, 'resid', [i, t], 2); };
	Run.prototype.mlpAt = function (l, t) { return rowOf(this, 'mlp', [l, t], 2); };
	Run.prototype.attnAt = function (l, h, t) { return rowOf(this, 'attn', [l, h, t], 3); };
	Run.prototype.midAt = function (l, t) { return rowOf(this, 'mid', [l, t], 2); };
	Run.prototype.pre1At = function (l, t) { return rowOf(this, 'pre1', [l, t], 2); };
	Run.prototype.pre3At = function (l, t) { return rowOf(this, 'pre3', [l, t], 2); };

	Model.prototype.run = function (ids, opts) {
		var m = this, c = m.config, T = checkIds(m, ids);
		var dim = c.dim, L = c.layers, H = c.heads, hidden = c.hidden, vocab = c.vocab, kvDim = m.kvDim;
		var keep, plan, x, K, V, out, rec, emb = m.weights.tokEmb, l, t, i, eo;
		opts = checkOptions(opts, RUN_KEYS, 'run') || {};
		keep = keepOf(opts.keep);
		plan = compileEdits(m, opts.edits, T);
		x = new Float32Array(T * dim);
		K = new Float32Array(L * T * kvDim);
		V = new Float32Array(L * T * kvDim);
		out = { T: T, shape: {} };
		if (keep.logits) { out.logits = new Float32Array(T * vocab); out.shape.logits = [T, vocab]; }
		if (keep.resid) { out.resid = new Float32Array((L + 1) * T * dim); out.shape.resid = [L + 1, T, dim]; }
		if (keep.mlp) { out.mlp = new Float32Array(L * T * hidden); out.shape.mlp = [L, T, hidden]; }
		if (keep.attn) { out.attn = new Float32Array(L * H * T * T); out.shape.attn = [L, H, T, T]; }
		if (keep.mid) { out.mid = new Float32Array(L * T * dim); out.shape.mid = [L, T, dim]; }
		if (keep.pre) {
			out.pre1 = new Float32Array(L * T * hidden); out.shape.pre1 = [L, T, hidden];
			out.pre3 = new Float32Array(L * T * hidden); out.shape.pre3 = [L, T, hidden];
		}
		rec = {
			attn: out.attn || null, attnBase: 0, attnStride: T * T,
			mid: out.mid || null, midOff: 0,
			pre1: out.pre1 || null, pre3: out.pre3 || null, preOff: 0,
			mlp: out.mlp || null, mlpOff: 0
		};

		for (t = 0; t < T; t++) {
			eo = ids[t] * dim;
			for (i = 0; i < dim; i++) x[t * dim + i] = emb[eo + i];
			if (plan) applyStation(plan, 0, t, x, t * dim, dim);
		}
		if (out.resid) out.resid.set(x, 0);

		for (l = 0; l < L; l++) {
			for (t = 0; t < T; t++) {
				rec.attnBase = (l * H * T + t) * T;         // head h adds h * T * T
				rec.midOff = (l * T + t) * dim;
				rec.preOff = rec.mlpOff = (l * T + t) * hidden;
				blockStep(m, l, t, x, t * dim, K, V, l * T * kvDim, plan, rec);
				if (plan) applyStation(plan, l + 1, t, x, t * dim, dim);
			}
			if (out.resid) out.resid.set(x, (l + 1) * T * dim);
		}

		if (out.logits) for (t = 0; t < T; t++) unembed(m, x, t * dim, out.logits, t * vocab);
		return new Run(out);
	};

	// ---------------------------------------------------------------- session
	//
	// The same pass one token at a time. The keys and values of earlier
	// positions are kept, so each new token costs one position, not the whole
	// sequence again.

	function Session(m, opts) {
		var c = m.config;
		opts = checkOptions(opts, ['edits'], 'session') || {};
		this.m = m;
		this.pos = 0;
		this.K = new Float32Array(c.layers * c.seqLen * m.kvDim);
		this.V = new Float32Array(c.layers * c.seqLen * m.kvDim);
		this.x = new Float32Array(c.dim);
		this.logits = new Float32Array(c.vocab);
		this.plan = compileEdits(m, opts.edits, c.seqLen);
	}

	// Feed the next token; get the scores for the one after it. The returned
	// array is reused: copy it if it must outlive the next feed().
	Session.prototype.feed = function (id) {
		var m = this.m, c = m.config, dim = c.dim, t = this.pos, x = this.x, plan = this.plan;
		var emb = m.weights.tokEmb, stride = c.seqLen * m.kvDim, l, i;
		if (t >= c.seqLen) fail('the context is full (' + c.seqLen + ' tokens)');
		if (!intIn(id, 0, c.vocab - 1)) fail('token id ' + id + ' is not in the vocabulary (0..' + (c.vocab - 1) + ')');
		for (i = 0; i < dim; i++) x[i] = emb[id * dim + i];
		if (plan) applyStation(plan, 0, t, x, 0, dim);
		for (l = 0; l < c.layers; l++) {
			blockStep(m, l, t, x, 0, this.K, this.V, l * stride, plan, NO_REC);
			if (plan) applyStation(plan, l + 1, t, x, 0, dim);
		}
		unembed(m, x, 0, this.logits, 0);
		this.pos = t + 1;
		return this.logits;
	};

	Model.prototype.session = function (opts) {
		return new Session(this, opts);
	};

	// --------------------------------------------------------------- sampling

	// mulberry32: a small seeded generator, the same one the toy kit uses.
	function rng(seed) {
		var a = seed >>> 0;
		return function () {
			var t;
			a = (a + 0x6D2B79F5) | 0;
			t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	// A number is used as it is; anything else is hashed as text (FNV-1a).
	function seedOf(seed) {
		var s, h, i;
		if (seed == null) return 1;
		if (typeof seed === 'number' && isFinite(seed)) return seed >>> 0;
		s = String(seed);
		h = 0x811C9DC5;
		for (i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	function argmax(a) {
		var best = 0, i;
		for (i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
		return best;
	}

	// Draw one token. Temperature 0 takes the best score. Otherwise the scores
	// are divided by the temperature, all but the topK best are dropped (0 keeps
	// everything), and the rest are drawn in proportion to exp(score).
	function pick(logits, temperature, topK, rand, tmp) {
		var n = logits.length, k, cut, quota, i, max, sum, p, coin, acc, last;
		if (!(temperature > 0)) return argmax(logits);
		k = (topK > 0 && topK < n) ? topK : n;
		cut = -Infinity;
		quota = 0;
		if (k < n) {
			tmp.set(logits);
			tmp.sort();
			cut = tmp[n - k];                   // the k-th best score; ties at the cut go to the lower ids
			quota = k;
			for (i = 0; i < n; i++) if (logits[i] > cut) quota--;
		}
		max = -Infinity;
		for (i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
		sum = 0;
		for (i = 0; i < n; i++) {
			p = 0;
			if (logits[i] > cut) p = Math.exp((logits[i] - max) / temperature);
			else if (logits[i] === cut && quota > 0) { p = Math.exp((logits[i] - max) / temperature); quota--; }
			tmp[i] = p;
			sum += tmp[i];
		}
		coin = rand() * sum;
		acc = 0;
		last = 0;
		for (i = 0; i < n; i++) {
			if (tmp[i] > 0) {
				acc += tmp[i];
				last = i;
				if (coin < acc) return i;
			}
		}
		return last;
	}

	// Scores to probabilities (a softmax), as a new Float32Array.
	function softmax(logits, temperature) {
		var n = logits.length, out = new Float32Array(n), t = temperature > 0 ? temperature : 1, max = -Infinity, sum = 0, i, p;
		for (i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
		for (i = 0; i < n; i++) { p = Math.exp((logits[i] - max) / t); out[i] = p; sum += p; }
		for (i = 0; i < n; i++) out[i] /= sum;
		return out;
	}

	// ----------------------------------------------------------------- stream
	//
	// Generation one token per next(), so a caller can stop, draw or yield
	// between tokens. generate() is this run to the end.

	function Stream(m, ids, opts) {
		var n = checkIds(m, ids);
		opts = checkOptions(opts, GENERATE_KEYS, 'generate') || {};
		this.m = m;
		this.ids = Array.prototype.slice.call(ids);
		this.prompt = n;
		this.temperature = numOf(opts.temperature, 0, 'temperature');
		if (this.temperature < 0) fail('temperature must be 0 or more (0 always takes the most likely token)');
		this.topK = opts.topK == null ? 0 : opts.topK;
		if (!intIn(this.topK, 0, 1e9)) fail('topK must be a whole number, 0 for no limit');
		this.maxNew = opts.maxNew == null ? m.config.seqLen : opts.maxNew;
		if (!intIn(this.maxNew, 0, 1e9)) fail('maxNew must be a whole number');
		this.rand = rng(seedOf(opts.seed));
		this.stopAtBos = opts.stopAtBos !== false;
		this.onToken = typeof opts.onToken === 'function' ? opts.onToken : null;
		this.session = new Session(m, { edits: opts.edits });
		this.decoder = m.tokenizer.decoder();
		this.tmp = new Float32Array(m.config.vocab);
		this.logits = null;
		this.fed = 0;
		this.made = 0;
		this.done = false;
		this.reason = '';       // 'bos' the model ended the story, 'length' maxNew reached, 'context' no room left
		this.text = '';         // the text of the token next() just returned
	}

	Stream.prototype.finish = function (reason) {
		this.done = true;
		this.reason = reason;
		this.text = '';
		return -1;
	};

	// The next token id, or -1 when the stream has ended.
	Stream.prototype.next = function () {
		var id;
		if (this.done) return -1;
		if (this.made >= this.maxNew) return this.finish('length');
		if (this.ids.length >= this.m.config.seqLen) return this.finish('context');
		while (this.fed < this.ids.length) {
			id = this.ids[this.fed];
			this.logits = this.session.feed(id);
			if (this.fed < this.prompt) this.decoder.push(id);      // the prompt's text is the caller's already
			this.fed++;
		}
		id = pick(this.logits, this.temperature, this.topK, this.rand, this.tmp);
		if (id === BOS && this.stopAtBos) return this.finish('bos');
		this.ids.push(id);
		this.made++;
		this.text = this.decoder.push(id);
		if (this.onToken) this.onToken(id, this.text, this.ids.length - 1);
		return id;
	};

	Model.prototype.stream = function (ids, opts) {
		return new Stream(this, ids, opts);
	};

	// The prompt and what the model added to it, as one array of ids. The array
	// also carries .reason ('bos', 'length' or 'context').
	Model.prototype.generate = function (ids, opts) {
		var s = new Stream(this, ids, opts);
		while (s.next() >= 0) { /* onToken has been called */ }
		s.ids.reason = s.reason;
		return s.ids;
	};

	// ------------------------------------------------------ lens, unit writes

	// The k largest (or smallest) entries, best first; equal values in id order.
	function topIndices(values, k, largest) {
		var n = values.length, order, i, best;
		if (k === 1) {
			best = 0;
			for (i = 1; i < n; i++) if (largest ? values[i] > values[best] : values[i] < values[best]) best = i;
			return [best];
		}
		order = new Array(n);
		for (i = 0; i < n; i++) order[i] = i;
		order.sort(function (a, b) {
			var d = largest ? values[b] - values[a] : values[a] - values[b];
			return d || a - b;
		});
		return order.slice(0, k);
	}

	function countOf(k, fallback, n) {
		if (k == null) return fallback;
		if (!intIn(k, 1, n)) fail('k must be a whole number from 1 to ' + n);
		return k;
	}

	// What the final norm and the unembedding make of any vector the size of the
	// residual stream: one score per token.
	Model.prototype.lensLogits = function (vec, out) {
		var c = this.config;
		if (!vec || vec.length !== c.dim) fail('lens: the vector needs ' + c.dim + ' numbers');
		out = out || new Float32Array(c.vocab);
		unembed(this, vec, 0, out, 0);
		return out;
	};

	// The same, as the k most likely tokens: [{ id, token, logit, prob }].
	Model.prototype.lens = function (vec, k) {
		var logits = this.lensLogits(vec, this.scratch.logits), n = logits.length;
		var max = -Infinity, sum = 0, i, order, out = [];
		k = countOf(k, 5, n);
		for (i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
		for (i = 0; i < n; i++) sum += Math.exp(logits[i] - max);
		order = topIndices(logits, k, true);
		for (i = 0; i < order.length; i++) {
			out.push({ id: order[i], token: this.vocab[order[i]], logit: logits[order[i]], prob: Math.exp(logits[order[i]] - max) / sum });
		}
		return out;
	};

	// What one feed-forward unit writes, and which tokens that pushes up and
	// down by the direct path: its column of w2, times the final norm's gain,
	// times the unembedding. Later blocks may undo any of it; this does not look.
	//
	// effect leaves out the final norm's division by the length of the stream,
	// which depends on the position, so it is a direction, not a size. Given
	// `at`, the stream that reaches the final norm at one position
	// (run.residAt(5, t)), it also returns push: the first-order change in each
	// logit at that position per unit of activation, norm included:
	//   push = effect / r - logits(at) * (at . vec) / (dim * r^2),
	//   r = sqrt(mean(at^2) + 1e-5)
	Model.prototype.unitWrites = function (layer, unit, k, at) {
		var c = this.config, w = this.weights, dim = c.dim, hidden = c.hidden, vocab = c.vocab;
		var vec = new Float32Array(dim), effect = new Float32Array(vocab), d, v, sum, row, self = this;
		var x, ss, dot, ms, r, base, push, out;
		if (!intIn(layer, 0, c.layers - 1)) fail('unitWrites: layer ' + layer + ' is out of range 0..' + (c.layers - 1));
		if (!intIn(unit, 0, hidden - 1)) fail('unitWrites: unit ' + unit + ' is out of range 0..' + (hidden - 1));
		k = countOf(k, 8, vocab);
		if (at != null) x = vecOf(at, dim, 'unitWrites: at');
		for (d = 0; d < dim; d++) vec[d] = w.w2[(layer * dim + d) * hidden + unit];
		for (v = 0; v < vocab; v++) {
			sum = 0;
			row = v * dim;
			for (d = 0; d < dim; d++) sum += w.wcls[row + d] * w.rmsFinal[d] * vec[d];
			effect[v] = sum;
		}
		function entry(id) { return { id: id, token: self.vocab[id], value: effect[id] }; }
		out = {
			layer: layer,
			unit: unit,
			vec: vec,                                           // [dim] the direction it writes into the stream
			effect: effect,                                     // [vocab] vec through the final gain and the unembedding (no division by the stream's length)
			up: topIndices(effect, k, true).map(entry),
			down: topIndices(effect, k, false).map(entry)
		};
		if (x) {
			ss = 0;
			dot = 0;
			for (d = 0; d < dim; d++) { ss += x[d] * x[d]; dot += x[d] * vec[d]; }
			ms = ss / dim + 1e-5;
			r = Math.sqrt(ms);
			base = this.lensLogits(x, new Float32Array(vocab));
			push = new Float32Array(vocab);
			for (v = 0; v < vocab; v++) push[v] = effect[v] / r - base[v] * dot / (dim * ms);
			out.rms = r;                                        // the final norm's divisor at that stream
			out.push = push;                                    // [vocab] first-order change in each logit there, per unit of activation
		}
		return out;
	};

	// ------------------------------------------------------------------ sweep
	//
	// Many edited runs of one text, measured against the unedited one. An edit
	// cannot change anything in an earlier block or at an earlier position, so
	// each member starts from the baseline at the first block and position its
	// own edits touch, and only the rest is computed again.

	function logSumExp(a, off, n) {
		var max = -Infinity, sum = 0, i;
		for (i = 0; i < n; i++) if (a[off + i] > max) max = a[off + i];
		for (i = 0; i < n; i++) sum += Math.exp(a[off + i] - max);
		return max + Math.log(sum);
	}

	function Sweeper(m, ids, editSets, opts) {
		var c = m.config, T = checkIds(m, ids), dim = c.dim, L = c.layers, vocab = c.vocab, kvDim = m.kvDim;
		var emb = m.weights.tokEmb, baseList, basePlan, own, i, l, t, d, eo, x, raw, lse, rec;
		if (opts && opts.onProgress != null) fail('sweep: onProgress is for llm.sweep in the workers; model.sweeper(...).next() gives progress here');
		opts = checkOptions(opts, SWEEP_KEYS.slice(0, -1), 'sweep') || {};
		if (!Array.isArray(editSets)) fail('sweep: the edit sets must be an array, each entry one edit or a list of edits');
		this.m = m;
		this.T = T;
		this.ids = Array.prototype.slice.call(ids);
		this.n = editSets.length;
		this.i = 0;
		this.done = this.n === 0;
		this.at = opts.at == null ? T - 1 : opts.at;
		if (!intIn(this.at, 0, T - 1)) fail('sweep: at ' + opts.at + ' is out of range 0..' + (T - 1));
		this.wantLoss = opts.loss !== false && T > 1;
		this.wantLogits = !!opts.logits;

		baseList = listOf(opts.base);
		basePlan = compileEdits(m, baseList, T);
		this.plans = new Array(this.n);
		this.firstLayer = new Int32Array(this.n);
		this.firstPos = new Int32Array(this.n);
		this.ffOnly = new Uint8Array(this.n);
		for (i = 0; i < this.n; i++) {
			try {
				own = compileEdits(m, editSets[i], T);
				this.firstLayer[i] = own ? own.firstLayer : L + 1;
				this.firstPos[i] = own ? own.firstPos : T;
				// In its first block, does the member only touch feed-forward units? Then that
				// block's attention is the baseline's too, and the member can start after it.
				if (own && own.firstLayer < L && !own.head[own.firstLayer] && !own.station[own.firstLayer]) this.ffOnly[i] = 1;
				this.plans[i] = (own && baseList.length) ? compileEdits(m, baseList.concat(listOf(editSets[i])), T) : (own || basePlan);
			} catch (err) {
				fail('sweep: edit set ' + i + ': ' + String(err.message).replace(/^LLM: /, ''));
			}
		}

		// The baseline, keeping what a member needs to start half-way: every block's keys and
		// values, the residual at every station before that station's own edits, and inside
		// every block the residual after attention and the hidden activations.
		x = this.x = new Float32Array(T * dim);
		raw = this.raw = new Float32Array((L + 1) * T * dim);
		this.K0 = new Float32Array(L * T * kvDim);
		this.V0 = new Float32Array(L * T * kvDim);
		this.mid0 = new Float32Array(L * T * dim);
		this.h0 = new Float32Array(L * T * c.hidden);
		rec = { attn: null, mid: this.mid0, midOff: 0, pre1: null, pre3: null, mlp: this.h0, mlpOff: 0 };
		for (t = 0; t < T; t++) {
			eo = this.ids[t] * dim;
			for (d = 0; d < dim; d++) raw[t * dim + d] = x[t * dim + d] = emb[eo + d];
			if (basePlan) applyStation(basePlan, 0, t, x, t * dim, dim);
		}
		for (l = 0; l < L; l++) {
			for (t = 0; t < T; t++) {
				rec.midOff = (l * T + t) * dim;
				rec.mlpOff = (l * T + t) * c.hidden;
				blockStep(m, l, t, x, t * dim, this.K0, this.V0, l * T * kvDim, basePlan, rec);
				for (d = 0; d < dim; d++) raw[((l + 1) * T + t) * dim + d] = x[t * dim + d];
				if (basePlan) applyStation(basePlan, l + 1, t, x, t * dim, dim);
			}
		}
		this.K = new Float32Array(this.K0);
		this.V = new Float32Array(this.V0);

		// Baseline measurements. nll[t] is the surprise at the token that really follows position t.
		this.row = new Float32Array(vocab);
		this.baseLogits = new Float32Array(vocab);
		this.baseLogp = new Float64Array(vocab);
		this.baseNll = new Float64Array(T);         // prefix sums: baseNll[t] = the sum over positions before t
		this.baseLoss = NaN;
		for (t = 0; t < T; t++) {
			if (t !== this.at && !this.wantLoss) continue;
			unembed(m, x, t * dim, this.row, 0);
			lse = logSumExp(this.row, 0, vocab);
			if (t === this.at) {
				this.baseLogits.set(this.row);
				for (d = 0; d < vocab; d++) this.baseLogp[d] = this.row[d] - lse;
			}
			if (this.wantLoss && t < T - 1) this.baseNll[t + 1] = this.baseNll[t] + (lse - this.row[this.ids[t + 1]]);
		}
		if (this.wantLoss) this.baseLoss = this.baseNll[T - 1] / (T - 1);
		this.baseTop = argmax(this.baseLogits);
		this.target = opts.target == null ? this.baseTop : opts.target;
		if (!intIn(this.target, 0, vocab - 1)) fail('sweep: target ' + opts.target + ' is not a token id (0..' + (vocab - 1) + ')');

		// One entry per edit set; NaN (and -1 for top) until that set has been run.
		this.kl = new Float32Array(this.n).fill(NaN);
		this.pTarget = new Float32Array(this.n).fill(NaN);
		this.top = new Int32Array(this.n).fill(-1);
		this.loss = this.wantLoss ? new Float32Array(this.n).fill(NaN) : null;
		this.logits = this.wantLogits ? new Float32Array(this.n * vocab).fill(NaN) : null;
	}

	// Run the next edit set. Returns false once there is nothing left to do.
	Sweeper.prototype.next = function () {
		var m = this.m, c = m.config, T = this.T, dim = c.dim, L = c.layers, vocab = c.vocab, kvDim = m.kvDim;
		var i = this.i, plan, l0, p0, x = this.x, raw = this.raw, row = this.row, hidden = c.hidden, hb = m.scratch.hb;
		var l, t, d, a, b, lse, kl, lp, nll, best, first;
		if (this.done) return false;
		plan = this.plans[i];
		l0 = this.firstLayer[i];
		p0 = this.firstPos[i];

		// unchanged unless the edits reach the measured position
		this.kl[i] = 0;
		this.pTarget[i] = Math.exp(this.baseLogp[this.target]);
		this.top[i] = this.baseTop;
		if (this.loss) this.loss[i] = this.baseLoss;
		if (this.logits) this.logits.set(this.baseLogits, i * vocab);

		if (l0 <= L && p0 < T) {
			first = l0;
			if (this.ffOnly[i]) {
				// block l0: the baseline's attention stands; redo only the write of the hidden units
				for (t = p0; t < T; t++) {
					for (d = 0; d < dim; d++) x[t * dim + d] = this.mid0[(l0 * T + t) * dim + d];
					for (d = 0; d < hidden; d++) hb[d] = this.h0[(l0 * T + t) * hidden + d];
					ffWrite(m, l0, t, x, t * dim, plan, NO_REC);
					applyStation(plan, l0 + 1, t, x, t * dim, dim);
				}
				first = l0 + 1;
			} else {
				for (t = p0; t < T; t++) {
					for (d = 0; d < dim; d++) x[t * dim + d] = raw[(l0 * T + t) * dim + d];
					applyStation(plan, l0, t, x, t * dim, dim);
				}
			}
			for (l = first; l < L; l++) {
				for (t = p0; t < T; t++) {
					blockStep(m, l, t, x, t * dim, this.K, this.V, l * T * kvDim, plan, NO_REC);
					applyStation(plan, l + 1, t, x, t * dim, dim);
				}
			}
			nll = this.baseNll[Math.min(p0, T - 1)];
			for (t = p0; t < T; t++) {
				if (t !== this.at && !(this.loss && t < T - 1)) continue;
				unembed(m, x, t * dim, row, 0);
				lse = logSumExp(row, 0, vocab);
				if (this.loss && t < T - 1) nll += lse - row[this.ids[t + 1]];
				if (t === this.at) {
					kl = 0;
					best = 0;
					for (d = 0; d < vocab; d++) {
						lp = row[d] - lse;
						kl += Math.exp(this.baseLogp[d]) * (this.baseLogp[d] - lp);
						if (row[d] > row[best]) best = d;
					}
					this.kl[i] = kl > 0 ? kl : 0;
					this.pTarget[i] = Math.exp(row[this.target] - lse);
					this.top[i] = best;
					if (this.logits) this.logits.set(row, i * vocab);
				}
			}
			if (this.loss) this.loss[i] = nll / (T - 1);
			// put the baseline's keys and values back where this member wrote its own
			for (l = first; l < L; l++) {
				a = (l * T + p0) * kvDim;
				b = (l + 1) * T * kvDim;
				this.K.set(this.K0.subarray(a, b), a);
				this.V.set(this.V0.subarray(a, b), a);
			}
		}

		this.i = i + 1;
		if (this.i >= this.n) this.done = true;
		return !this.done;
	};

	Sweeper.prototype.result = function () {
		var out = {
			n: this.n,
			done: this.i,
			cancelled: false,
			at: this.at,
			target: this.target,
			base: {
				top: this.baseTop,
				pTarget: Math.exp(this.baseLogp[this.target]),
				loss: this.baseLoss,
				logits: this.baseLogits
			},
			kl: this.kl,
			pTarget: this.pTarget,
			top: this.top,
			loss: this.loss
		};
		if (this.logits) out.logits = this.logits;
		return out;
	};

	Model.prototype.sweeper = function (ids, editSets, opts) {
		return new Sweeper(this, ids, editSets, opts);
	};

	// Throws, in plain words, if the edits are not ones run() would take for a text of T tokens
	// (T left out: any position inside the context is accepted, as generate() does).
	Model.prototype.checkEdits = function (edits, T) {
		compileEdits(this, edits, T == null ? this.config.seqLen : T);
		return true;
	};

	// Throws if the model cannot take these ids; otherwise returns how many there are.
	Model.prototype.checkIds = function (ids) {
		return checkIds(this, ids);
	};

	Model.prototype.sweep = function (ids, editSets, opts) {
		var s = new Sweeper(this, ids, editSets, opts);
		while (s.next()) { /* one edit set per call */ }
		return s.result();
	};

	// How surprised the model is by a text: the mean, in nats per token, of
	// -log p(the token that really comes next), over every position but the last.
	// NaN for a text of one token.
	Model.prototype.loss = function (ids, opts) {
		var run = this.run(ids, { edits: checkOptions(opts, ['edits'], 'loss') && opts.edits, keep: ['logits'] }), T = run.T, vocab = this.config.vocab, sum = 0, t;
		if (T < 2) return NaN;
		for (t = 0; t < T - 1; t++) sum += logSumExp(run.logits, t * vocab, vocab) - run.logits[t * vocab + ids[t + 1]];
		return sum / (T - 1);
	};

	// ------------------------------------------------------------------- host
	//
	// A request handler with no opinion about transport. worker.js hands it the
	// messages of a Web Worker; client.js calls it directly when no Worker can
	// be started. Long jobs work in slices of SLICE_MS and yield in between, so
	// a "cancel" (or a short request) gets in.
	//
	//   request     { id, cmd, args }      cmd: load, run, generate, sweep, cancel, encode, decode, lens, unitWrites
	//   reply       { id, ok: true, result }  |  { id, ok: false, error }
	//   on the way  { id, event: 'tokens', ids, texts, pos }                  from generate
	//               { id, event: 'progress', done, total, from, kl, pTarget, top, loss }   from sweep: the
	//               results of edit sets from .. done - 1, so a page can draw them as they come

	var deferQueue = null;

	function defer(fn) {
		var channel;
		if (typeof setImmediate === 'function') { setImmediate(fn); return; }
		if (typeof MessageChannel === 'undefined') { setTimeout(fn, 0); return; }
		if (!deferQueue) {
			deferQueue = [];
			channel = new MessageChannel();
			channel.port1.onmessage = function () {
				var next = deferQueue.shift();
				if (next) next();
			};
			deferQueue.port = channel.port2;
		}
		deferQueue.push(fn);
		deferQueue.port.postMessage(0);
	}

	function buffersOf(obj) {
		var out = [], k;
		for (k in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] && tagOf(obj[k].buffer) === '[object ArrayBuffer]' && out.indexOf(obj[k].buffer) < 0) {
				out.push(obj[k].buffer);
			}
		}
		return out;
	}

	function messageOf(err) {
		return String(err && err.message ? err.message : err);
	}

	function Host(model) {
		this.model = model || null;
		this.jobs = {};
	}

	Host.prototype.handle = function (msg, post) {
		var id = msg && msg.id, cmd = msg && msg.cmd, a = (msg && msg.args) || {}, m, r, job;
		try {
			if (cmd === 'cancel') {
				job = this.jobs[a.target];
				if (job) job.cancelled = true;
				post({ id: id, ok: true, result: !!job });
				return;
			}
			if (cmd === 'load') {
				this.model = load(a.bin, a.tok);
				post({ id: id, ok: true, result: { config: this.model.config, params: this.model.params } });
				return;
			}
			m = this.model;
			if (!m) fail('no model is loaded yet');
			if (cmd === 'run') {
				r = m.run(a.ids, a.opts);
				post({ id: id, ok: true, result: r }, buffersOf(r));
			} else if (cmd === 'encode') {
				post({ id: id, ok: true, result: m.encode(a.text, a.opts) });
			} else if (cmd === 'decode') {
				post({ id: id, ok: true, result: m.decode(a.ids) });
			} else if (cmd === 'lens') {
				post({ id: id, ok: true, result: m.lens(a.vec, a.k) });
			} else if (cmd === 'unitWrites') {
				post({ id: id, ok: true, result: m.unitWrites(a.layer, a.unit, a.k, a.at) });
			} else if (cmd === 'generate') {
				this.generate(id, a, post);
			} else if (cmd === 'sweep') {
				this.sweep(id, a, post);
			} else {
				fail('unknown command "' + cmd + '"');
			}
		} catch (err) {
			post({ id: id, ok: false, error: messageOf(err) });
		}
	};

	Host.prototype.generate = function (id, a, post) {
		var self = this, o = a.opts || {}, job = { cancelled: false }, batch = { ids: [], texts: [], pos: 0 }, stream;
		stream = this.model.stream(a.ids, {
			maxNew: o.maxNew, temperature: o.temperature, topK: o.topK, seed: o.seed, edits: o.edits, stopAtBos: o.stopAtBos,
			onToken: function (tid, text, pos) {
				if (!batch.ids.length) batch.pos = pos;
				batch.ids.push(tid);
				batch.texts.push(text);
			}
		});
		this.jobs[id] = job;
		function slice() {
			var t0 = now(), err = null, ids;
			try {
				while (!job.cancelled && !stream.done && now() - t0 < SLICE_MS) stream.next();
			} catch (e) {
				err = e;
			}
			if (batch.ids.length) {
				post({ id: id, event: 'tokens', ids: batch.ids, texts: batch.texts, pos: batch.pos });
				batch = { ids: [], texts: [], pos: 0 };
			}
			if (err) {
				delete self.jobs[id];
				post({ id: id, ok: false, error: messageOf(err) });
			} else if (stream.done || job.cancelled) {
				delete self.jobs[id];
				ids = stream.ids.slice();
				post({ id: id, ok: true, result: { ids: ids, reason: stream.done ? stream.reason : 'cancelled' } });
			} else {
				defer(slice);
			}
		}
		defer(slice);
	};

	Host.prototype.sweep = function (id, a, post) {
		var self = this, job = { cancelled: false }, sent = 0, sweeper = this.model.sweeper(a.ids, a.editSets, a.opts);
		this.jobs[id] = job;
		function slice() {
			var t0 = now(), err = null, result, part;
			try {
				while (!job.cancelled && !sweeper.done && now() - t0 < SLICE_MS) sweeper.next();
			} catch (e) {
				err = e;
			}
			if (err) {
				delete self.jobs[id];
				post({ id: id, ok: false, error: messageOf(err) });
				return;
			}
			if (sweeper.i > sent) {
				// what this slice added, so a page can draw results as they come
				part = {
					id: id, event: 'progress', done: sweeper.i, total: sweeper.n, from: sent,
					kl: sweeper.kl.slice(sent, sweeper.i),
					pTarget: sweeper.pTarget.slice(sent, sweeper.i),
					top: sweeper.top.slice(sent, sweeper.i),
					loss: sweeper.loss ? sweeper.loss.slice(sent, sweeper.i) : null
				};
				sent = sweeper.i;
				post(part, buffersOf(part));
			}
			if (sweeper.done || job.cancelled) {
				delete self.jobs[id];
				result = sweeper.result();
				result.cancelled = !sweeper.done;
				post({ id: id, ok: true, result: result }, buffersOf(result).concat(buffersOf(result.base)));
			} else {
				defer(slice);
			}
		}
		defer(slice);
	};

	// ---------------------------------------------------------------- exports

	return {
		load: load,
		tokenizer: function (tokInput, vocabSize) { return new Tokenizer(tokInput, vocabSize == null ? 512 : vocabSize); },
		host: function (model) { return new Host(model); },
		wrap: function (raw) { return raw instanceof Run ? raw : new Run(raw); },
		copyEdits: copyEdits,
		checkOptions: checkOptions,
		optionNames: { run: RUN_KEYS, generate: GENERATE_KEYS, sweep: SWEEP_KEYS },
		softmax: softmax,
		rng: rng,
		seedOf: seedOf,
		BOS: BOS,
		EOS: EOS,
		UNK: UNK
	};
});
