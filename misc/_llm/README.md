# The model kit

`misc/_llm/` is a small language model that runs in the visitor's browser and hands back every number it computes on the way: the residual stream, every feed-forward unit's activation, every attention weight. It can also change them (switch a unit off, add a direction, swap in the state of another run) and show what the change does. A toy loads it by relative path. There is no server, no build step, and no request to any other host.

The model is **stories260K** by Andrej Karpathy (MIT): 260,032 parameters, trained on TinyStories, so it writes children's stories and knows nothing else. `llm.js` is his C program `run.c` rewritten in JavaScript. Both samples in upstream's readme come out token for token: the 256 tokens it prints when it always takes the most likely one, and the 256 it draws at temperature 1 with seed 133742 (for that one the test rebuilds upstream's sampler; a draw depends on every probability, not only on the largest).

| File | What it is |
| --- | --- |
| `llm.js` | `window.LLM` and `module.exports`: tokenizer, model, edits, generation, sweeps. No DOM, no network. The same file runs on a page, in a worker and under Node. |
| `client.js` | `window.LLMClient`: fetches the weights, builds a model on the page, and starts workers for the heavy calls, behind promises. |
| `worker.js` | What the workers run. `client.js` starts it; a page never loads it with a script tag. |
| `weights/stories260K.bin`, `weights/tok512.bin` | The checkpoint (1,056,540 bytes) and its tokenizer (6,227 bytes), byte for byte as upstream serves them. |
| `test.js` | `node misc/_llm/test.js`: 55 checks, among them the examples and measurements this document quotes (all but the timings). |
| `build-fetch-weights.mjs` | Downloads the two weight files again and verifies them; `--check` verifies the copies on disk. |
| `LICENSES.md` | Sources, hashes, licences, and a credit line for a page's footer. |

There is no `tok.js`: the tokenizer lives in `llm.js`. A page that needs only the tokenizer loads `llm.js` with a script tag (not the client, which always downloads the megabyte of weights), fetches `weights/tok512.bin` (6,227 bytes) as an ArrayBuffer itself, and calls `LLM.tokenizer(tokBuffer)`. That returns an object with `encode(text, { bos, eos })` and `decode(ids)` (the same as on the model), `vocab` (the 512 strings), `scores` (each piece's merge score, a `Float32Array`), `decoder()` (a streaming decoder: `push(id)` returns the text that id completes, holding back a character whose bytes are not all in yet), `size` (512), and internals a page does not need (`raw`, `bytes`, `lookup`, `pairs`, `spaceId`, `maxTokenLength`).

## Start

```html
<script src="../_llm/client.js"></script>
```

```js
LLMClient.create({
	onProgress: function (got, total) { bar.value = got / total; }     // 1,062,767 bytes to fetch
}).then(function (llm) {
	var model = llm.model;                                  // the model on the page, synchronous
	var ids = model.encode('Once upon a time');             // [1, 403, 407, 261, 378]
	var out = model.generate(ids, { temperature: 0.8, topK: 40, seed: 'lily', maxNew: 60 });
	model.decode(out);    // "Once upon a time, there was a little girl named Lily. She loved to play
	                      //  with her toys and go on factals. One day, Lily found a ball with a small
	                      //  doll in her backyard. She"
	var run = model.run(out);                               // every internal value for that text
	run.attnAt(4, 0, out.length - 1);                       // where head 0 of the last block looks from the last token
	return llm.sweep(out, sets, { onProgress: drawCells }); // hundreds of edited runs, in the workers ("Sweeps" builds sets)
}).catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
```

`client.js` loads `llm.js` by itself if the page has not. Call `create()` after the first paint and show its progress: it downloads a megabyte. Everything is served from this folder; add nothing to `origins` in `toy.json`.

Without the client (a page that needs no worker, or Node):

```js
// page: <script src="../_llm/llm.js"></script>, then fetch the two files as ArrayBuffers
var model = LLM.load(binArrayBuffer, tokArrayBuffer);
// Node
const LLM = require('./misc/_llm/llm.js');
const model = LLM.load(fs.readFileSync('misc/_llm/weights/stories260K.bin'), fs.readFileSync('misc/_llm/weights/tok512.bin'));
```

`LLM.load` takes ArrayBuffers or typed arrays (a Node Buffer is one). It keeps views on the checkpoint's bytes instead of copying them, so do not change that buffer or hand it to a worker afterwards. It throws a plain sentence if a file is the wrong size.

## The model in one picture

```
ids --> embedding: row ids[t] of a 512 x 64 table ------------------------------> resid[0]
        block l = 0 .. 4, at every position t:
          attention      x += wo . (8 heads, each a weighted mix of what positions 0..t offer)
                         the weights are attn[l][h][t][0..t]                        (mid[l])
          feed-forward   h = silu(w1 . norm(x)) * (w3 . norm(x))      172 units      mlp[l]
                         x += w2 . h ---------------------------------------------> resid[l + 1]
        final norm, then the dot product with every row of the same table --------> logits[t]
```

- Every position carries 64 numbers, the **residual stream**. Nothing else passes from one block to the next.
- This document calls the first index of `resid` a **station**: station 0 is the stream right after the embedding, station `i` is the stream after `i` blocks, station 5 is what the logits are computed from.
- A block never reads the stream itself. It reads a normalised copy (RMSNorm: the vector divided by the root of its mean square, then multiplied by a learned gain per dimension) and adds its output to the stream.
- **Attention**: 8 heads in each block, 40 in all, each working on 8 numbers. At position `t` a head spreads a weight of 1 over positions 0 to `t` and adds a mix of what those positions offer. Position is not part of the embedding: it enters here, by rotating the head's queries and keys by an angle that grows with the position (RoPE). Heads `2k` and `2k + 1` share their key and value weights (4 key/value heads serve 8 query heads): the two heads of a pair see the same keys and move the same values; they differ in what they ask and in how their result is written back.
- **Feed-forward**: 172 units in each block, 860 in all. A unit takes two weighted sums of the normalised stream (its rows of `w1` and `w3`); its activation is `silu(first) * second`, where `silu(z) = z / (1 + e^-z)`. The activation times the unit's column of `w2` is what the unit adds to the stream.
- There are no bias terms anywhere, and the output matrix is the embedding table itself.
- `logits[t]` scores every token as the one that comes **after** position `t`.
- At most 512 positions.

## The synchronous API

`model` below is what `LLM.load()` returns, and what the client offers as `llm.model`.

| Call | Gives |
| --- | --- |
| `model.config` | `{ dim: 64, hidden: 172, layers: 5, heads: 8, kvHeads: 4, vocab: 512, seqLen: 512 }` |
| `model.params`, `model.tied` | `260032`; `true` (the output matrix is the embedding table) |
| `model.vocab` | The 512 token strings (see "Tokens"). |
| `model.encode(text, { bos: true, eos: false })` | An array of ids. The start token (id 1) comes first unless `bos: false`. |
| `model.decode(ids)` | The text. `decode(encode(text)) === text` for any well-formed string; a lone surrogate (half of an emoji's pair, say, from slicing a string by code units) has no UTF-8 bytes and comes back as U+FFFD. |
| `model.run(ids, { edits, keep })` | Every internal value for a text; see "What a run returns". |
| `model.lens(vec, k = 5)` | What the final norm and the output matrix make of any 64 numbers: `[{ id, token, logit, prob }]`, best first. |
| `model.lensLogits(vec, out)` | The same as all 512 scores (a `Float32Array`; pass `out` to reuse one). |
| `model.unitWrites(layer, unit, k = 8, at)` | The direction a unit writes and the tokens it pushes up and down directly; with `at` (a stream such as `run.residAt(5, t)`) also the size of the push there; see "What a unit writes". |
| `model.generate(ids, opts)` | The prompt plus what the model added, as one array of ids; see "Generating". |
| `model.stream(ids, opts)` | The same one token per call: `next()` returns an id, or -1 at the end. |
| `model.session({ edits })` | The raw key-value cache: `feed(id)` returns the logits for the next token (in an array it reuses at the next `feed`), `pos` counts the tokens fed. |
| `model.sweep(ids, editSets, opts)` | Many edited runs measured against the unedited one; see "Sweeps". |
| `model.sweeper(ids, editSets, opts)` | The same, one edit set per `next()`. |
| `model.loss(ids, { edits })` | How surprised the model is by a text: the mean of `-log p(the token that really comes next)`, in nats per token. |
| `model.checkEdits(edits, T)`, `model.checkIds(ids)` | Throw the same messages `run` would; return `true` and the number of ids. |
| `model.weights` | The matrices themselves; see "Weights". |
| `model.copy()` | A second model with its own copy of the weights, for changing them; see "Weights". |
| `LLM.softmax(logits, temperature = 1)` | Probabilities, as a new `Float32Array`. |
| `LLM.BOS`, `LLM.EOS`, `LLM.UNK` | 1, 2, 0 |

Wrong arguments throw an `Error` that says what is wrong in plain words (`LLM: edit 0 (ablate): unit 172 is out of range 0..171`). That includes a name an options object or an edit does not take, so a misspelling such as `position` for `pos` or `maxnew` for `maxNew` throws (`LLM: edit 0 (ablate): unknown option "position" (known: type, layer, unit, value, pos)`) instead of being ignored, and a negative `temperature`. Nothing fails silently.

`LLM.host`, `LLM.wrap`, `LLM.copyEdits`, `LLM.checkOptions` and `LLM.optionNames` are what `client.js` and `worker.js` are built from; a page does not need them.

### Tokens

The vocabulary has 512 entries, so most words are several tokens: `" girl"` is `" g"`, `"ir"`, `"l"`. Generated story text runs at about 2.25 characters per token.

| Ids | What |
| --- | --- |
| 0 `<unk>`, 1 `<s>`, 2 `</s>` | Specials. Every sequence starts with `<s>` (`encode` puts it there), and the model ends a story by predicting `<s>` again. Upstream prepared the training text with the start token and without the end token, so the model has never seen `</s>`. `encode` never produces `<unk>`: a character with no piece is spelt in bytes instead. |
| 3 to 258 | The 256 raw bytes, written `<0x00>` to `<0xFF>`. They spell any character that has no piece of its own. The line break is one of them: id 13, `<0x0A>`. |
| 259 to 511 | 253 learned pieces. A leading space marks the start of a word: `" the"`, `" Lily"`, `"ing"`. |

- To label one token in a picture, use `model.vocab[id]`: it keeps the leading space and shows the specials and bytes by name. Those names look like HTML tags (`<s>`, `</s>`, `<0x0A>`), so put them on the page with `textContent` (or SVG `<text>`'s `textContent`), never `innerHTML`: `<s>` would start a strikethrough instead of showing a label.
- `model.decode(ids)` gives real text: specials give nothing, bytes are joined back into characters, and the piece right after the start token loses its leading space (`encode` put that space there; ids made with `bos: false` decode with it still in front).
- To find a token by its text: `model.vocab.indexOf(' Lily')` is 317. If the answer is -1 the word is not a single token.

### What a run returns

`model.run(ids, { edits, keep })` returns flat `Float32Array`s. `T` is the number of ids.

| Field | Shape | Flat index | What it is |
| --- | --- | --- | --- |
| `logits` | `[T][512]` | `t * 512 + v` | For each position, a score for every token as the next one. `LLM.softmax(run.logitsAt(t))` turns a row into probabilities. |
| `resid` | `[6][T][64]` | `(i * T + t) * 64 + d` | The residual stream at each station: `resid[0]` is the embedding of each token (exactly its row of the table), `resid[i]` the stream after `i` blocks. |
| `mlp` | `[5][T][172]` | `(l * T + t) * 172 + u` | The activation of each feed-forward unit: the number that multiplies the unit's column of `w2` when it writes to the stream. It can be negative. |
| `attn` | `[5][8][T][T]` | `((l * 8 + h) * T + t) * T + s` | For block `l`, head `h` and position `t`: the weight it gives to each position `s`. Every row sums to 1 and is 0 for `s > t`. |
| `mid` | `[5][T][64]` | `(l * T + t) * 64 + d` | The stream inside block `l`, after its attention and before its feed-forward part. Only with `keep: [..., 'mid']`. |
| `pre1`, `pre3` | `[5][T][172]` | `(l * T + t) * 172 + u` | The two weighted sums behind each unit: `mlp = silu(pre1) * pre3`. Only with `keep: [..., 'pre']`. |
| `T`, `shape` | | | The number of positions, and the shapes above, for example `run.shape.attn` is `[5, 8, T, T]`. |

Accessors return views, without copying: `run.logitsAt(t)` (512 numbers), `run.residAt(i, t)` (64), `run.mlpAt(l, t)` (172), `run.attnAt(l, h, t)` (`T` numbers: how position `t` spreads its attention), `run.midAt(l, t)`, `run.pre1At(l, t)`, `run.pre3At(l, t)`. An index out of range throws.

`keep` is a list of names: `'logits'`, `'resid'`, `'mlp'`, `'attn'`, `'mid'`, `'pre'`. The default is the first four. Ask only for what will be drawn: `attn` holds `40 * T * T` numbers, which is 1.6 MB at `T` = 100 and 42 MB at `T` = 512.

From these, what a block adds to the stream is a subtraction: attention added `mid[l] - resid[l]`, the feed-forward units added `resid[l + 1] - mid[l]` (when no edit sits at those stations).

### Edits

`edits` is one edit or a list of them, applied in the order given. **In every edit, `layer` is the first index of the array the edit changes.**

| Edit | What it does | `layer` means |
| --- | --- | --- |
| `{ type: 'ablate', layer, unit, value: 0, pos }` | Sets the activation `mlp[layer][.][unit]` to `value`, at every position or only at `pos`. | block 0 to 4 |
| `{ type: 'head', layer, head, scale: 0, pos }` | Multiplies what one attention head adds by `scale`. 0 removes it. | block 0 to 4 |
| `{ type: 'steer', layer, vec, alpha: 1, pos }` | `resid[layer] += alpha * vec`, at every position or only at `pos`. `vec` is 64 numbers. | station 0 to 5 |
| `{ type: 'patch', layer, pos, from }` | `resid[layer][pos] = from`, 64 numbers, usually `otherRun.residAt(layer, pos)`. | station 0 to 5 |

- So `{ type: 'steer', layer: 3 }` changes the stream after three blocks, before the block with index 3 reads it, and `{ type: 'ablate', layer: 3 }` works inside the block with index 3.
- `value`, `scale` and `alpha` are any finite numbers. `value: 0` is the usual ablation; `value: otherRun.mlpAt(l, t)[u]` grafts an activation from another text.
- A run returns the edited values: `mlp` shows the clamped activation, `resid` the steered or patched vector. A head switched off still reports where it looked; only what it adds is scaled.
- An edit changes nothing in an earlier block and nothing at an earlier position.
- Identities that are tested, to the last bit: `ablate` with the unit's own activation, `patch` with the run's own residual, `head` with `scale: 1` and `steer` with `alpha: 0` all change nothing. Patching every position of a station with another run's residuals gives that other run's logits.
- `generate`, `stream`, `session` and `sweep` take the same edits. There `pos` counts from the start of the whole sequence, prompt included.

Where the vectors for `steer` come from is up to the page: a token's row of the table (`model.weights.tokEmb.subarray(id * 64, id * 64 + 64)`), a unit's write direction (`model.unitWrites(l, u).vec`), or the difference of two runs' residuals at one station. For scale: on the sentence measured below the stream's mean length grows from 2.0 at station 0 to 13.0 at station 5, and the rows of the table are between 1.4 and 3.2 long.

### The logit lens

`model.lens(vec, k)` runs any 64 numbers through the final norm and the output matrix and returns the `k` most likely tokens with their probabilities. Fed `run.residAt(5, t)` it returns the model's own prediction at `t` (tested at every position). Fed an earlier station, it shows what the unfinished stream would say if the model stopped there.

Two things to know before drawing it. At station 0 the lens returns the token that was just read (on the 45-token sentence below, at every position and with a probability of 0.98 or more), because the output matrix is the embedding table: that is the model reading its own input, not a prediction. And agreement with the final answer comes late: on the same sentence the lens named the model's final top token at 0, 1, 2, 12, 25 and 45 of the 45 positions, at stations 0 to 5.

A grid of all stations by all positions is `6 * T` calls; 192 of them took 5 ms.

### What a unit writes

`model.unitWrites(layer, unit, k, at)` returns

- `vec`: the unit's column of `w2`, 64 numbers: the direction it adds to the stream, per unit of activation;
- `effect`: 512 numbers: `vec`, times the final norm's gain, times the output matrix. This says **which way** the unit pushes each token's score by the direct path, and how the tokens compare. It is not the size of the push: it leaves out the final norm, which divides the stream by its length (its root mean square) before the output matrix reads it, and that length differs from position to position;
- `up`, `down`: the `k` tokens with the largest and the smallest `effect`, as `[{ id, token, value }]`;
- with `at`, the 64 numbers that reach the final norm at one position (`run.residAt(5, t)`), also `rms`, the norm's divisor there, and `push`: 512 numbers, the change in each logit at that position per unit of activation, norm included, to first order. It is `effect / rms`, less a correction because the push also changes the stream's length: `push[v] = effect[v] / rms - lensLogits(at)[v] * dot(at, vec) / (64 * rms * rms)`, with `rms = sqrt(mean(at * at) + 1e-5)`.

How big the difference is, on the 45-token sentence under "Worked examples": the stream's root mean square at station 5 runs from 1.05 to 2.1 over its positions after the start token (2.3 at the start token), so `effect` alone overstates the push by up to about twice. For last-block unit 96 and `" She"`, `effect` is -2.18 everywhere; raising the unit by 1 really moved that logit by -1.39, -1.46 and -1.80 at positions 5, 20 and 44, and `push` there is -1.37, -1.43 and -1.62. For small changes `push` is the slope: over all 172 last-block units at six positions it matched a step of 0.01 to within 0.2% of the largest change in a logit, where `effect` alone was off by more than half at the median (tested). A whole step of 1 is not small next to a length of 1 to 2, which is why -1.62 and -1.80 differ. For the last block the exact answer for any step is `model.lensLogits(moved)` minus `model.lensLogits(at)`, where `moved` is `at` plus `step * vec`.

Read it with care. The direct path ignores every later block, and a negative activation pushes the other way (activations are negative about half the time). The test measures how well `effect` predicts the pattern of what really happens to the logits when a unit is raised by 1 at the last position of a sentence (a correlation, which ignores the scale): the median over 25 units per block was 0.33, 0.28, 0.56, 0.63 and 0.99 for blocks 0 to 4. So for the last block `effect` gets the pattern right and `push` the size, and for the other blocks both are a rough guess that is sometimes wrong in sign, because the later blocks react to what the unit wrote.

An example of the output, not a finding: `model.unitWrites(4, 96, 5).down` is `" She"`, `" her"`, `" she"`, `"ily"`, `" Lily"` (`effect` values near -2.1, which is not the change in their logits; see above).

### Generating

```js
var out = model.generate(ids, {
	maxNew: 120,           // at most this many new tokens (default: until the context is full)
	temperature: 0.8,      // 0, the default, always takes the most likely token
	topK: 40,              // draw only among the 40 most likely (default 0: no limit)
	seed: 'lily',          // a number or a string (default 1); the same seed gives the same text
	edits: edits,          // the model runs with these edits at every step
	onToken: function (id, text, pos) {},   // called for each new token; pos is its index in the whole sequence
	stopAtBos: true        // stop when the model predicts the start token, which is how it ends a story
});
out.reason;                // 'bos' (the model ended the story), 'length' (maxNew) or 'context' (512 tokens)
```

- The result is a plain array: the prompt's ids followed by the new ones. It never exceeds 512 ids, so it can go straight into `run`.
- The `text` pieces handed to `onToken` join up to exactly `decode(out)` minus `decode(prompt)`.
- Taking the most likely token every time gets stuck in loops (upstream's own sample says "didn't know what to do" four times). `temperature: 0.8, topK: 40` reads better. Of ten such stories started from the start token alone (seeds 1 to 10), eight ended by themselves, after 175 to 419 tokens, and two ran into the 512-token limit.
- Generation keeps a key-value cache, so each new token costs one position. It gives the same logits as a full run, bit for bit (tested).
- With no `maxNew`, generation goes on until the story ends or the context is full.

To show a story appearing, drive it yourself: `var s = model.stream(ids, opts); id = s.next();` returns the next id (its text is `s.text`), and -1 once the stream has ended (`s.done`, with `s.reason`); `s.ids` grows as it goes. One `next()` cost about a quarter of a millisecond at the start of the context and about three times that near its end, so one token per animation frame on the page is fine. To show the internals of generated text, generate first, then `run` the result once (with the same `edits`) and animate from the arrays.

### Sweeps

A sweep runs one text many times, each time with a different set of edits, and measures each against the unedited run. This is the ablation table: which of the 860 units matter for this text?

```js
var sets = [];
for (var l = 0; l < 5; l++) for (var u = 0; u < 172; u++) sets.push({ type: 'ablate', layer: l, unit: u });
var r = model.sweep(ids, sets, { at: ids.length - 1 });
```

Each entry of `editSets` is one edit or a list of edits applied together. Options: `at` (the position measured, default the last), `target` (a token id to follow, default the unedited run's top token at `at`), `loss: false` (skip the loss, about a fifth faster), `logits: true` (also return every edited logit row at `at`), `base` (edits applied to the baseline and to every member, so the sweep measures against an already edited model).

| Result | What it is |
| --- | --- |
| `n`, `done`, `cancelled` | How many edit sets; how many were run; whether the sweep was stopped early. |
| `at`, `target` | The position and the token measured. |
| `kl[i]` | How far edit set `i` moved the next-token distribution at `at`: the Kullback-Leibler divergence from the unedited distribution, in nats. 0 means no change. |
| `pTarget[i]` | The probability of `target` at `at` under edit set `i`. |
| `top[i]` | The most likely token at `at` under edit set `i`. |
| `loss[i]` | The mean surprise, in nats, at the tokens of this text that really came next, over all positions, under edit set `i`: the average of `-log p(ids[t + 1])`. "What the world does worse" is `loss[i] - base.loss`. `null` with `loss: false` or a one-token text. |
| `logits` | With `logits: true`: `[n][512]`, the edited scores at `at`. |
| `base` | `{ top, pTarget, loss, logits }` for the unedited run (`logits` is its row at `at`). |

- Entries that were not run (after a cancel) read `NaN`, and -1 in `top`.
- A sweep gives exactly the numbers that one `run` per edit set would give (tested, bit for bit). It is faster because an edit cannot change an earlier block or an earlier position, and those parts are computed once. An edit set that touches only the last position costs almost nothing; one that touches block 0 at every position costs nearly a full run.
- `model.sweep` blocks until it is done. `llm.sweep` (below) does the same in the workers. `model.sweeper(ids, sets, opts)` does one edit set per `next()` (false when finished), with `kl`, `pTarget`, `top`, `loss` filling in as it goes and `result()` at any time.
- For one set of edits, `model.loss(ids, { edits })` is the same number as `loss[i]`, and `model.loss(ids)` the same as `base.loss`.

On the 45-token sentence below, the unedited loss is 0.324 nats per token. Zeroing unit 66 of block 0 at every position raises it to 0.471, the largest rise of the 860. 48 units raise it by more than 0.01, and 208 lower it by more than 0.001: removing a unit quite often makes this model slightly better at one sentence. That is one sentence.

### Weights

`model.weights` holds views on the checkpoint, as flat `Float32Array`s.

| Name | Shape | |
| --- | --- | --- |
| `tokEmb` (also `wcls`) | `[512][64]` | Embedding and output matrix: token `v` is `subarray(v * 64, v * 64 + 64)`. |
| `rmsAtt`, `rmsFfn` | `[5][64]` | The gains of the norm before attention and before the feed-forward part. |
| `rmsFinal` | `[64]` | The gain of the final norm. |
| `wq`, `wo` | `[5][64][64]` | Queries; the attention output. |
| `wk`, `wv` | `[5][32][64]` | Keys and values, for 4 key/value heads. |
| `w1`, `w3` | `[5][172][64]` | What unit `u` of block `l` reads: `w1[(l * 172 + u) * 64 + d]`, the same for `w3`. |
| `w2` | `[5][64][172]` | What it writes: `w2[(l * 64 + d) * 172 + u]` into dimension `d`. |

Do not write to the weights of the model the page shares. To see what changed weights do (rounded to fewer levels, the smallest set to zero), take `var twin = model.copy()` and write to `twin.weights`: the twin is a full model of its own, and the original and the workers are untouched. `tokEmb` and `wcls` are one array, so changing it changes both ends of the model. A twin lives on the page only; `llm.run`, `llm.generate` and `llm.sweep` always use the original weights.

## Workers: LLMClient

```js
LLMClient.create({ onProgress, workers, base }).then(function (llm) { ... });
```

| Option | |
| --- | --- |
| `onProgress(got, total)` | Called while the weights download; `total` is 1,062,767. |
| `workers` | How many workers to start. Default: one fewer than the processor's cores, at least 1, at most 4. `workers: 0` (or `worker: false`) starts none. |
| `base` | The URL of this folder. `client.js` normally knows it from its own address. |

`create()` fetches the two files once, builds `llm.model` on the page from them, and gives each worker a copy. It rejects with an `Error` whose `message` is a sentence a reader can be shown, whose `detail` is the technical part, and whose `plain` is `true`, which is what `ToyKit.fail(err)` needs to show that sentence (without `plain` it shows its own general sentence). The errors of a mistaken call (`llm.run` with a unit out of range, an unknown option) have `plain: false`, since `LLM: edit 0 (ablate): ...` is for the builder: `ToyKit.fail(err)` then shows its general sentence and puts the message under Details.

| On `llm` | |
| --- | --- |
| `llm.model` | The synchronous model above, on the page. Use it for everything cheap: `encode`, `decode`, `lens`, `unitWrites`, short generations, single runs. |
| `llm.config`, `llm.vocab` | The same as on `llm.model`. |
| `llm.run(ids, { edits, keep })` | A promise of the same run object, computed in a worker (the arrays are moved, not copied). |
| `llm.generate(ids, opts)` | A promise of the ids. `opts` as for `model.generate`; `onToken` is called on the page as tokens arrive, in batches. |
| `llm.sweep(ids, editSets, opts)` | A promise of the sweep result. The edit sets are shared out between the workers. |
| `opts.onProgress(done, total, part)` | For `sweep`: called as results arrive. `part` is `{ index, kl, pTarget, top, loss }`: `index[j]` says which edit set `part.kl[j]` belongs to. They arrive out of order. |
| `promise.cancel()` | On the promise `generate` or `sweep` returned: stop that job. |
| `llm.cancel()` | Stop every `generate` and `sweep` still running. |
| `llm.mode`, `llm.threads`, `llm.workerError` | `'worker'` and the number of workers; or `'main'`, 0 and the reason, when none could be started. |
| `llm.close()` | Stop the workers. Calls after that reject. |

- A cancelled job resolves, it does not reject: `generate` with the ids it has so far (`ids.reason === 'cancelled'`), `sweep` with `cancelled: true` and `NaN` where nothing was run.
- A mistake in a call (a unit out of range, too many tokens) rejects with the same message the synchronous model would throw.
- Jobs run side by side: a short `run` gets its answer while a sweep is still going.
- Without workers (`mode === 'main'`) the same calls run on the page in slices of 12 ms, so the page keeps drawing, more slowly.
- Vectors in edits may be views such as `run.residAt(2, 5)`; the client copies the 64 numbers before sending.
- The numbers are the same whether a call runs on the page or in a worker (tested in Chrome: logits equal bit for bit, and sweeps equal a plain synchronous sweep).

For the thumbnail (`?thumb=1`), compute with `llm.model` or wait for one promise, use a fixed seed, and draw in the task that has the result.

## Speeds

Measured on 2026-10-03 on the machine the site is built on (a desktop that reports 16 cores), in headless Chrome 154 through the test harness. A range is the spread over four runs. In two other runs, while other programs kept the processor busy, everything took about twice as long (256 tokens on the page in 150 to 170 ms). A phone will be slower, and nobody has measured one.

| What | Time |
| --- | --- |
| `LLMClient.create()` from a local server, four workers | 28 to 38 ms |
| `LLM.load` | 2 to 3 ms |
| `encode` of 565 characters | 0.4 ms |
| Greedy generation on the page, 100 tokens | 25 to 26 ms (3,900 to 4,000 tokens a second) |
| Greedy generation on the page, 256 tokens | 88 to 92 ms (2,800 to 2,900 tokens a second) |
| One token at the start of the context / near its end | 0.25 to 0.27 ms / 0.73 to 0.77 ms (a late token attends to more) |
| The same 256 tokens through a worker, as timed on the page | 99 to 117 ms (2,200 to 2,600 tokens a second) |
| `model.run`, everything kept, `T` = 32 / 100 / 512 | 8 ms / 26 to 28 ms / 257 to 277 ms |
| `llm.run`, everything kept, there and back, `T` = 32 / 100 / 512 | 14 to 17 ms / 29 to 38 ms / 267 to 370 ms |
| Lens grid, 192 cells | 5 ms |
| Sweep, 860 units each zeroed at the last position only, `T` = 32: on the page / four workers | 155 to 177 ms / 50 to 81 ms |
| Sweep, 860 units each zeroed at every position, `T` = 32: four workers | 1.0 to 1.7 s (0.8 to 1.0 s with `loss: false`) |
| The same with one worker | 3.3 to 4.1 s |
| The same on the page with `model.sweep` | 3.0 to 5.3 s, and the page is frozen for all of it |
| One block's 172 units at every position, four workers | 0.3 to 0.4 s |

Under Node 24, 100 tokens took 24 to 30 ms (3,300 to 4,100 tokens a second) on a quiet machine and 53 to 72 ms on a busy one.

During a four-worker sweep the page went on drawing (123 to 195 frames in 1.0 to 1.6 s). So: generation, single runs, the lens and last-position sweeps are fine on the page; a sweep over every position belongs in `llm.sweep`.

## What the memoir says and what this model has

`misc/32-latentland-map/world.js` glosses each place with a machine-learning idea. The memoir's Unit 4091 lives in a far larger model of a different design. A page that lets a reader touch this model has to be right about this one.

| Place in `world.js` | Its gloss | In stories260K | In the kit |
| --- | --- | --- | --- |
| `warmth`, `layer` | A neuron's activation is one number; 16,384 units in a layer | 172 units in each of 5 blocks | `run.mlp` |
| `total`, `tributaries` | The pre-activation is one weighted sum over 4,096 dimensions | Two weighted sums per unit, over 64 dimensions | `pre1`, `pre3`; `weights.w1`, `w3` |
| `bias` | A constant added to the sum | No bias terms exist in this model | none |
| `gate`, `cold`, `dead`, `eldergate`, `mystic` | GELU or ReLU silences a unit below zero; most units are off most of the time | `silu(a) * b` has no floor: activations are negative about half the time. Whether any unit is always near zero has not been checked | `run.mlp` |
| `weather` | A unit's activation histogram | Not precomputed; a page can build it from `run.mlp` over generated text | `run.mlp` |
| `relation` | Heads compare queries with keys | 40 heads; pairs share keys and values | `run.attn` |
| `rememberer` | Induction heads | Not looked for | none |
| `scapegoat` | Surplus attention goes to the first token | Not established here; weak on the one sentence measured (below) | `run.attnAt(l, h, t)[0]` |
| `stylites` | A few huge, constant activations | Not looked for | `run.resid` |
| `river`, `headwaters`, `delta` | The residual stream, growing through the layers | 64 numbers, 6 stations; it did grow on the sentence measured | `run.resid` |
| `draught` | Layer normalisation before each block | RMSNorm: no mean is subtracted, and there is no bias | `weights.rmsAtt`, `rmsFfn`, `rmsFinal` |
| `embed` | The embedding layer | A 512 by 64 table; position is not embedded, it is a rotation inside attention | `resid[0]`, `weights.tokEmb` |
| `cliff` | The unembedding matrix | The embedding table again, after the final norm | `lens`, `lensLogits` |
| `dice` | Sampling with a temperature | The same | `generate`, `LLM.softmax` |
| `probe`, `ablation` | Reading a unit and overwriting it; zeroing; patching from another input | The same, exactly | `ablate`, `patch`, `sweep` |
| `bridge` | A learned feature clamped high | No learned features here. A page can add a direction it chooses | `steer` |
| `probes` | Linear probes and the logit lens | The lens only | `lens` |
| `crossroads`, `dictionary` | Superposition; sparse autoencoders | 172 units write into 64 dimensions, so their directions overlap; nothing more is known. No autoencoder | `unitWrites().vec` |
| `rim`, `light`, `ledger`, `batch`, `tax`, `dropout`, `damascus`, `statue`, `silence` | Training | The kit only runs the finished model. Upstream's readme gives the recipe: 100,000 steps, batch 128, dropout 0.05, weight decay 0.01 | none |
| `pruning`, `quantization` | Dropping the smallest weights; storing weights in fewer bits | Not done to this model: the weights are the 32-bit floats upstream published. A page can do the textbook version to a copy (worked example below) | `model.copy()`, `model.loss` |
| `distillation`, `unlearning`, `districts` | A student model; removing what was learned | Nothing | none |

## Worked examples

All measured with this kit on 2026-10-03 and pinned in `test.js`. Each is one text, not a law.

**One sentence, measured.** "Once upon a time, there was a little girl named Lily. She loved to play outside in the park. One day, she saw a big, red ball." is 45 tokens.

- The mean length of the residual vector at stations 0 to 5: 2.0, 4.0, 5.6, 7.6, 10.5, 13.0. From station 1 on, the start token's vector is the longest.
- Share of activations below zero, blocks 0 to 4: 48, 50, 49, 49, 50 percent. Share within 0.05 of zero: 47, 39, 35, 28, 24 percent.
- The mean weight a head puts on position 0 ranges from 0.01 to 0.22 over the 40 heads.

**Patching.** "Lily went to the park." and "Tim went to the park." are 10 tokens each, with the name at position 1. After the first the model gives `" She"` 0.75 and `" He"` 0.03; after the second, `" He"` 0.71 and `" She"` 0.03. Run the first text with one residual vector taken from the second:

```js
var A = model.encode('Lily went to the park.'), B = model.encode('Tim went to the park.');
var runB = model.run(B, { keep: ['resid'] });
var out = model.run(A, { edits: { type: 'patch', layer: i, pos: 1, from: runB.residAt(i, 1) }, keep: ['logits'] });
LLM.softmax(out.logitsAt(9))[model.vocab.indexOf(' He')];
```

| Patched position | p(`" He"`) with the patch at station 0, 1, 2, 3, 4, 5 |
| --- | --- |
| 1, the name | 0.71, 0.71, 0.70, 0.60, 0.61, 0.03 |
| 5, `" the"` | 0.03 at every station |
| 9, the full stop | 0.03, 0.03, 0.04, 0.09, 0.10, 0.71 |

On this pair, swapping the name's vector flips the pronoun at any station up to 4, and swapping the last position's vector does almost nothing before station 5, where it is the whole answer. So here it is the last block that brings the name to the prediction.

**Steering.** Add the row of `" Lily"` (id 317, length 1.92) at station 3, at every position, while generating greedily from "Once upon a time":

```js
var row = model.weights.tokEmb.subarray(317 * 64, 318 * 64);
model.generate(ids, { maxNew: 24, edits: { type: 'steer', layer: 3, vec: row, alpha: alpha } });
```

- `alpha: 1`: "Once upon a time, there was a little girl named Lily. She loved to play with her dolls. She lo"
- `alpha: 2`: "Once upon a time, there was a little girl named Lily Lily Lily Lily Lily Lily Lily Lily Lily Lily was a she she lo"
- `alpha: 4`: "Once upon a time Lily Lily Lily Lily ..." (nothing else)

That is a token's own direction, which the output matrix reads straight back. It is not a feature anyone found in the model.

**Ablation.** Greedy from "Once upon a time", 40 tokens: "...named Lily. She loved to play outside in the park. One day, she saw a big, red ball." With `{ type: 'ablate', layer: 0, unit: 66 }`: "...named Lily. She loved to play with her toys and her friends. One day, Lily's mommy told her that they we".

**Changed weights.** Round every number in the eight matrices of a copy to a few evenly spaced levels (the largest size in each matrix sets its scale), or set the smallest numbers of each matrix to zero. The loss is `twin.loss(story)` on one sampled story of 200 tokens (`generate([1], { temperature: 0.8, topK: 40, seed: 1, maxNew: 200 })`); the text is the twin's greedy continuation of "Once upon a time", 20 tokens.

```js
var twin = model.copy(), levels = Math.pow(2, bits - 1) - 1;
['tokEmb', 'wq', 'wk', 'wv', 'wo', 'w1', 'w2', 'w3'].forEach(function (name) {
	var w = twin.weights[name], max = 0, i;
	for (i = 0; i < w.length; i++) max = Math.max(max, Math.abs(w[i]));
	for (i = 0; i < w.length; i++) w[i] = Math.round(w[i] / max * levels) / levels * max;
});
```

| Weights | Loss | Greedy text |
| --- | --- | --- |
| as published | 0.99 | "Once upon a time, there was a little girl named Lily. She loved to play outsid" |
| 8 bits (127 levels each side of zero) | 1.00 | the same |
| 6 bits | 1.11 | the same |
| 5 bits | 1.46 | "Once upon a time, there was a little boy named Timmy. Timmy loved two friends," |
| 4 bits | 4.13 | "Once upon a time, there antar named Tlrrromierld. Therevz" |
| smallest 20% of each matrix set to zero | 1.05 | the same as published |
| smallest 40% | 2.69 | "Once upon a time, there was a little giroodob. It lived a myst" |
| smallest 60% | 6.15 | (the word "time" repeated, then commas) |

These are the plainest forms of quantization and magnitude pruning, with no retraining; real systems do better.

## Limits

- **512 tokens of context**, and generated text counts. At 2.25 characters a token that is a little over a thousand characters.
- **A 512-token vocabulary** splits words into small pieces, so a "token" on screen is often a fragment (`" g"`, `"ir"`, `"l"`), and a word is rarely one unit of anything.
- **It only knows children's stories**, and turns anything else into one: after "The stock market fell" the most likely continuation is " on the ground. It was a big, red ball." By upstream's own account it trained for about ten minutes on one GPU and reaches a validation loss of 1.2968.
- **Greedy output loops.** Use a temperature for text meant to be read.
- **English only**, and no instructions, questions or chat.
- **Not bit-identical to the C program.** Sums are accumulated in double precision here and in single precision there. The two samples upstream published come out the same, 256 tokens each; nothing else was compared, and the C program itself was not run here.
- **Its own sampler is not upstream's.** `generate` draws with top-k and a different random generator, so a seed here gives a different story than the same seed there.
- **Possibly not bit-identical between browsers.** `Math.exp`, `Math.cos` and `Math.sin` may differ in the last digit between engines, which could in rare cases change a sampled token. Node and Chrome (both V8) agree exactly; Firefox and Safari were not tested.
- **Memory**: `attn` for a full context is 42 MB; each worker holds its own copy of the megabyte of weights.
- The model is too small to be useful for anything except looking inside it.

## What nobody has checked

Nobody has checked whether any single unit or head of this model means anything. No study of stories260K's insides is known to the author of this kit, and the kit is not one.

What the kit gives is exact arithmetic: what a unit's activation was, what the logits become when it is clamped, which tokens its output vector points at. Those are measurements of effects on particular texts. A label such as "the unit for girls' names" is a claim about meaning, and nothing here supports one:

- 172 units write into 64 dimensions in every block, so their directions overlap and a unit is unlikely to be about one thing;
- `unitWrites` matched what really happened only in the last block (the correlations above);
- an effect measured on one sentence may vanish or reverse on the next;
- most tokens are fragments of words.

So, on a page: show the measurement, and say what was measured and on which text. Do not name units or heads. Do not say this model has induction heads, an attention sink, massive activations, superposition or dead units unless the page measures it there and then, and says how. Ablation, activation patching, steering by adding a vector and the logit lens are here in their textbook forms; they are not the method of any paper on this site, and the builder brief asks a page that demonstrates a technique to say so.

## Checks, rebuilding, credit

```
node misc/_llm/test.js                          55 checks; exit code 1 on any failure (20 to 60 s)
node misc/_llm/build-fetch-weights.mjs --check  the weight files against their recorded SHA-256
node misc/_llm/build-fetch-weights.mjs          download them again (huggingface.co, a pinned revision)
```

The browser was checked through `scripts/qa/drive.mjs` with a scratch page mounted beside the repo: the golden sample on the page, in a worker and with no worker; the same seeded sample as Node; pooled sweeps equal to synchronous ones; cancelling; a missing `worker.js`; no request to any host but the site's own.

A line for a page's "How it works" footer is at the end of `LICENSES.md`: the model is stories260K by Andrej Karpathy (MIT), trained on TinyStories (Eldan and Li, 2023); the arithmetic follows his llama2.c; the site serves its own copy of the weights.
