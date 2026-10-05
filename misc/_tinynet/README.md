# TinyNet

A tiny neural-network trainer in plain JavaScript that trains in the visitor's browser in seconds. It is a shared kit, not a toy: toys load it by relative path (`../_tinynet/...`).

| File | What it is |
| --- | --- |
| `tinynet.js` | `window.TinyNet` (also `self.TinyNet` in a worker and `module.exports` in Node). Pure: typed arrays, no DOM, no dependencies, no `Math.random`. |
| `worker.js` | A Web Worker that holds one modular-addition trainer and serves it over messages. |
| `client.js` | `window.TinyNetClient`: a promise API over the worker, for a page. |
| `snapshots.js` | `window.TINYNET_SNAPSHOTS`: four trained networks and two loss-landscape slices, 363 KB. Generated. |
| `test.js` | `node misc/_tinynet/test.js`: 165 checks, PASS/FAIL lines, exit code 1 on a failure. It contains four full training runs; three of them train in worker threads. Times are under "Measured". |
| `../../scripts/build-grok-snapshots.mjs` | Rebuilds `snapshots.js` (`--check` compares instead of writing). About 40 s on 3 October, 77 s on the busy machine of 5 October. |

Two things are in `tinynet.js`:

1. **A small generic dense network** (`create`, `forward`, `backward`, three losses, two optimisers, `serialize`, `lerp`, a per-unit hook) for any toy that needs a little network.
2. **`TinyNet.grok()`**, a trainer for `a + b mod p` with one hidden layer, and the experiments six toys run on it: grokking, a Fourier look at the hidden units, unlearning, merging, training-data attribution, loss-landscape slices.

## What these methods are called, and the sentence to print

Everything here is the textbook version of a known technique, run on a toy model. Use these names:

| In this kit | Standard name | A reference for a footer |
| --- | --- | --- |
| `grok()`, `step()` | Grokking on modular addition: delayed generalisation long after the training set is fitted | Power et al., "Grokking: Generalization Beyond Overfitting on Small Algorithmic Datasets", 2022; the one-hidden-layer version follows Gromov, "Grokking modular arithmetic", 2023 |
| `spectrum()` | Fourier analysis of the learned weights | Nanda et al., "Progress measures for grokking via mechanistic interpretability", 2023 |
| `unlearn({ method: 'retrain' })` | Exact unlearning by retraining from scratch without the forget set (the baseline every approximate method is compared with) | Bourtoule et al., "Machine Unlearning", 2021 |
| `unlearn({ method: 'ascent' })` | Gradient ascent on the forget set | Golatkar et al., "Eternal Sunshine of the Spotless Net", 2020 (where it is a baseline) |
| `unlearn({ method: 'finetune' })` | Fine-tuning on the retain set | the same |
| `merge({ align: true })` | Permutation alignment (weight matching) before weight averaging | Ainsworth et al., "Git Re-Basin: Merging Models modulo Permutation Symmetries", 2023 |
| `merge({ align: false })` | Plain weight averaging, linear interpolation between two networks | Goodfellow et al., "Qualitatively characterizing neural network optimization problems", 2015 |
| `influence()` | Gradient-similarity attribution | Charpiat et al., "Input Similarity from the Neural Network Perspective", 2019; the inner-product form is one checkpoint of TracIn, Pruthi et al., 2020 |
| `slice()` | Loss-landscape slices with per-layer normalisation | Li et al., "Visualizing the Loss Landscape of Neural Nets", 2018 (they normalise per filter; this is the simpler per-layer variant); the plane through three networks is from Garipov et al., 2018 |

A toy built on this kit prints, in its "How it works" footer:

> These are textbook techniques on a toy model, not the method or the result of any paper on this site.

Do not present a number from this kit as a finding. The numbers below are measurements of this one small network.

## Start here

```html
<script src="../_tinynet/tinynet.js"></script>
<script src="../_tinynet/snapshots.js"></script>   <!-- only if the toy uses a trained network; 363 KB -->
<script src="../_tinynet/client.js"></script>
<script src="app.js"></script>
```

```js
var net = TinyNetClient.start('../_tinynet/worker.js');   // the URL is relative to the PAGE
net.init({ seed: 1 })                                      // every other setting keeps its default
	.then(function (m) {
		// m: { epoch: 0, trainLoss, trainAcc, testLoss, testAcc, cfg, nTrain, nTest, params }
		return net.train({
			epochs: 1500, every: 10, include: { table: true },
			onProgress: function (pr) { drawCurvePoint(pr.epoch, pr.trainAcc, pr.testAcc); drawTable(pr.table); }
		});
	})
	.then(function (end) { say('test accuracy ' + end.testAcc); })
	.catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });   // err.message is a sentence for the reader
```

Which side to compute on:

- **Training, retraining and slices go to the worker.** 300 epochs on the page's own thread froze it for 2.9 s in the browser check (4.1 s on a busy machine). With the worker the page kept its full frame rate through a 1500-epoch run: 120 frames a second against 111 idle, longest gap between two frames 10.5 ms (3 October); 60 against 54 to 59 idle, longest gap 17.4 and 18.6 ms (5 October, twice, when the test browser ran at 60 Hz).
- **Everything else is quick enough for the page itself**, which is what a thumbnail needs (`?thumb=1` must draw in the same task, without waiting for a worker). Measured on Chrome's main thread: `TinyNet.restore(TINYNET_SNAPSHOTS.grokked)` 6 ms (25 ms the first time); `table()` 5 ms; `spectrum()` 0.3 ms; `influence()` 6 ms; `merge()` with alignment 8 ms; 30 steps of `unlearn` ascent 31 ms (184 ms with a curve point per step); a 9 by 9 `slice` 260 ms. On a busy machine all of these doubled (see "Other costs"). `TINYNET_SNAPSHOTS.slices` holds two ready 25 by 25 slices.
- Results are the same on both sides and in Node, bit for bit (see "Determinism"), so a toy can also precompute in a `build-*.mjs` of its own.
- Under reduced motion do not start training by itself: show a snapshot and let the reader press the button.

Where each of the six toys would start (`S` is `TINYNET_SNAPSHOTS`, `net` a client; every call is described further down):

| Toy | First state | Then |
| --- | --- | --- |
| Live grokking | `net.init({ seed })`; `S.grokked.curve` for the thumbnail | `net.train({ epochs: 1500, every: 10, include: { table: true, spectrum: true, norms: true }, onProgress })`; `net.set({ wd })` works in mid-run |
| Unlearning bench | `net.restore(S.grokked)` | `net.unlearn({ method, forget, steps, onProgress })`; `net.load(S.grokked)` puts the network back; `'retrain'` is a whole training run |
| Merging | `net.restore(S.grokked)` | `net.merge(S.second, { align, alpha, alphas, similarity })` |
| Attribution table | `TinyNet.restore(S.grokked)` on the page | `influence([a, b], { kind, parts })`, 6 ms |
| Loss-landscape map | `S.slices.around`, `S.slices.basins` (already computed) | `net.slice({ n, span, toward, onProgress })` |
| Ball on a loss surface | a slice of either kind | `lossAt({ xy })`, `gradAt({ xy })`, `planeWeights(x, y)` on its plane |

## Part 1: the generic network

A plain multilayer perceptron. Weights are `Float32Array`; activations and gradients are `Float64Array`.

### `TinyNet.create({ sizes, act, bias, seed, scale })` -> `net`

| Option | Default | Meaning |
| --- | --- | --- |
| `sizes` | required | `[in, h1, ..., out]`, at least two positive integers. |
| `act` | `'relu'` | Activation of every hidden layer: `'relu'`, `'tanh'`, `'sigmoid'`, `'square'` (x squared), `'linear'`. The output layer has none. |
| `bias` | `true` | `false` gives a network without biases. |
| `seed` | `1` | Number or string. The same seed gives the same weights everywhere. |
| `scale` | `1` | Multiplies the initial weights. |

Returns `{ sizes, act, bias, W, b }`. `W[l]` is `Float32Array(sizes[l] * sizes[l + 1])`; the weight from input `i` to output `j` of layer `l` is `W[l][i * sizes[l + 1] + j]`. `b[l]` is `Float32Array(sizes[l + 1])`, zero at the start (length 0 when `bias` is false). Initial weights are uniform: He (limit `sqrt(6 / fanIn)`) into a hidden relu layer, Glorot (limit `sqrt(6 / (fanIn + fanOut))`) otherwise. You may write into `W` and `b` directly.

### `TinyNet.forward(net, X, n, { hook })` -> `cache`

`X` holds `n` rows of `sizes[0]` numbers, row after row (any array). Returns `{ out, acts, pre, n, hooks }`:

- `out`: `Float64Array(n * sizes[last])`, the raw outputs (logits). Row `s` starts at `s * sizes[last]`.
- `acts[l]`: the activations of layer `l` (`acts[0]` is `X`, `acts[last]` is `out`), each `n * sizes[l]`.
- the whole object is what `backward` needs.

**The hook** lets a caller play one hidden unit: `{ hook: { layer, unit, values } }` replaces the activation of unit `unit` of hidden layer `layer` (1 for the first hidden layer) with `values[s]` for sample `s`. `{ layer, unit, fn }` calls `fn(s, activation)` instead and uses what it returns. An array of hooks is allowed. The hooked unit is treated as a constant chosen from outside.

### `TinyNet.backward(net, cache, dOut, { dX })` -> `grads`

`dOut` is the gradient of the loss with respect to `out`, as the loss functions return it. Returns `{ W, b, hook, hooks, dX }`: `W[l]` and `b[l]` are `Float64Array`s with the shapes of `net.W[l]` and `net.b[l]`. With `{ dX: true }`, `dX` is the gradient with respect to the inputs (`n * sizes[0]`), otherwise `null`.

With a hook in the cache: every other gradient is exact for the network as it ran (checked against finite differences in `test.js`); the weights and bias feeding the hooked unit get exactly zero; and `grads.hook` is `Float64Array(n)`, the gradient of the loss with respect to the value given for each sample (what the rest of the network would like that unit to have said). `grads.hooks[k]` is the same for the k-th hook.

```js
// The reader plays unit 3 of the first hidden layer: played[s] is what they answered for sample s.
var cache = TinyNet.forward(net, X, n, { hook: { layer: 1, unit: 3, values: played } });
var loss = TinyNet.softmaxCE(cache.out, y, n);
var grads = TinyNet.backward(net, cache, loss.dOut);
opt.step(grads);        // the rest of the network learns around the reader's unit; the unit's own incoming weights get no gradient
grads.hook[s];          // dLoss/d(played[s]): negative means a larger answer for sample s would have lowered the loss
```

### Losses

Each returns the loss and `dOut`, ready for `backward`.

| Call | Loss | Also returns |
| --- | --- | --- |
| `TinyNet.softmaxCE(out, labels, n)` | Mean over the `n` rows of softmax cross-entropy. `labels` is `n` class indices, or `n` rows of class probabilities. | `acc` (share of rows whose largest logit is the label), `probs` (`n` rows of softmax probabilities) |
| `TinyNet.mse(out, target, n)` | Mean of `(out - target)^2` over every number in `out`. | |
| `TinyNet.bce(out, target, n)` | Binary cross-entropy on **logits** (the sigmoid is applied inside), mean over every number in `out`; targets in [0, 1]. | `acc` (logit above 0 against target at least 0.5), `probs` (sigmoids) |

### Optimisers

`TinyNet.adamw(net, { lr, wd, beta1, beta2, eps })` and `TinyNet.sgd(net, { lr, momentum, wd })` return an object with `step(grads)` (updates `net` in place), `reset()`, and the settings as plain fields you may change between steps (`opt.lr = 0.01`).

- `adamw`: defaults `lr 0.001, wd 0.01, beta1 0.9, beta2 0.999, eps 1e-8`. Weight decay is decoupled (`w *= 1 - lr * wd`) and applied to weights, never to biases. Moments are bias-corrected.
- `sgd`: defaults `lr 0.1, momentum 0, wd 0`. `v = momentum * v + g; w -= lr * v`. Here `wd` is plain L2 added to the gradient of the weights.

```js
var net = TinyNet.create({ sizes: [2, 8, 2], act: 'tanh', seed: 4 });
var opt = TinyNet.adamw(net, { lr: 0.05, wd: 0 });
var X = [0, 0, 0, 1, 1, 0, 1, 1], y = [0, 1, 1, 0];          // XOR
for (var i = 0; i < 300; i++) {
	var cache = TinyNet.forward(net, X, 4);
	var loss = TinyNet.softmaxCE(cache.out, y, 4);
	opt.step(TinyNet.backward(net, cache, loss.dOut));
}                                                              // loss 6e-4, accuracy 1 (this is a test in test.js)
```

### Copies and files

| Call | Result |
| --- | --- |
| `TinyNet.clone(net)` | A separate copy. |
| `TinyNet.serialize(net)` | `{ sizes, act, bias, data }`, safe for `JSON.stringify`. `data` is base64 of the little-endian `Float32Array` bytes of `W[0], b[0], W[1], b[1], ...` (5.33 characters per weight). |
| `TinyNet.load(objectOrJsonText)` | The network back, bit for bit. Throws if the data does not fit the sizes. |
| `TinyNet.lerp(netA, netB, alpha)` | A new network with `(1 - alpha) * A + alpha * B` in every weight and bias. Same shapes required. |

### Helpers

| Call | What it does |
| --- | --- |
| `TinyNet.rng(seed)` | A seeded generator `r` (mulberry32 on an FNV-1a hash of the seed, number or string). `r()` in [0, 1), `r.int(n)`, `r.normal()` (standard normal), `r.shuffle(array)` in place. |
| `TinyNet.hungarian(cost)` | The assignment problem. `cost` is an array of `n` rows of `m >= n` numbers; returns `Int32Array(n)`, the column given to each row, minimising the total. `TinyNet.hungarian(flat, n)` takes a typed array of `n * m` numbers, row after row. |
| `TinyNet.exp`, `log`, `sigmoid`, `tanh` | Built from `+ - * /` only, so they give the same bits in every engine (within 1e-15 of `Math.exp` and `Math.log`). |
| `TinyNet.encodeFloats(array)`, `decodeFloats(text)` | Base64 of `Float32Array` bytes and back. |
| `TinyNet.acts` | The list of activation names. |
| `TinyNet.version` | `'1.0.0'`. |

## Part 2: the modular-addition trainer

The task: given `a` and `b` in `0..p-1`, answer `(a + b) mod p`. There are `p * p` pairs; a random `frac` of them is the training set and the rest is the test set.

The network: `h = act(W1a[a] + W1b[b])`, `logits = h . W2`. Two lookup tables of `p` rows by `hidden` numbers and one matrix of `hidden` rows by `p` numbers, no biases: `3 * p * hidden` weights (15,744 at the defaults). Training is full batch (every training pair in every step, so one step is one epoch), AdamW, mean softmax cross-entropy.

### `TinyNet.grok(config)` -> `trainer`

| Setting | Default | Meaning |
| --- | --- | --- |
| `p` | `41` | The modulus, 2 to 256. Need not be prime. |
| `hidden` | `128` | Hidden units, 1 to 4096. |
| `frac` | `0.6` | Share of the pairs used for training (`round(frac * p * p)` pairs: 1009 of 1681 at the defaults). |
| `lr` | `0.01` | AdamW learning rate. |
| `wd` | `1` | AdamW weight decay (decoupled). |
| `act` | `'relu'` | `'relu'` or `'square'`. `'tanh'`, `'sigmoid'` and `'linear'` run but do not grok (see the tables). |
| `seed` | `1` | Seeds the initial weights and, unless `splitSeed` is given, the train/test split. |
| `splitSeed` | `seed` | Seeds the split alone: two trainers with different `seed` and the same `splitSeed` are two initialisations on the same pairs. |
| `beta1`, `beta2`, `eps` | `0.9, 0.98, 1e-8` | Adam's constants. `beta2 = 0.999` is three times slower here; leave these alone. |
| `init` | `1` | Multiplies the initial weights (uniform in `+-1 / sqrt(fanIn)`, a linear layer's default in PyTorch). It hardly matters: 0.5, 2 and 4 all grok at the same time as 1. |
| `weights`, `epoch` | none | Start from given weights instead (see `load`). |

Bad settings throw an `Error` in plain words (`TinyNet: p must be an integer from 2 to 256`). `TinyNet.grokDefaults()` returns a copy of the defaults.

The trainer has `cfg` (the settings in force, every field filled in), `p`, `hidden`, `nTrain`, `nTest`, `epoch`, and these methods.

### Training

| Call | Returns |
| --- | --- |
| `step(epochs)` | Trains `epochs` epochs (default 1), then `{ epoch, trainLoss, trainAcc, testLoss, testAcc }` of the network as it now is. Accuracies are shares in [0, 1]; losses are mean cross-entropy. |
| `run(epochs)` | Trains without evaluating (an evaluation costs about one epoch). Returns the epoch counter. |
| `metrics()` | The same object as `step` returns, without training. Cached until the weights change. |
| `set({ lr, wd, beta1, beta2, eps })` | Changes the optimiser from the next epoch on; weights, moments and epoch stay. Returns the settings in force. Measured once each: switching `wd` from 0 to 1 on the memorised `noDecay` snapshot made it pass 99% test accuracy 1070 epochs later; switching `wd` to 0 on the `grokked` snapshot left it grokked (99.3% after 1500 more epochs). |
| `reset()` | Back to the seed's initial weights and epoch 0. Returns the metrics. |

### Looking inside

**`table()`** -> `{ p, pred, isTrain, prob }`, each of length `p * p`, **row `a`, column `b`**: index `a * p + b`. `pred` (`Uint8Array`) is the network's answer, `isTrain` (`Uint8Array`) is 1 for a training pair, `prob` (`Float32Array`) is the probability given to the right answer `(a + b) % p`. A cell is right when `pred[a * p + b] === (a + b) % p`.

**`spectrum({ of })`** -> the discrete Fourier transform of each hidden unit's weights over the `p` values of one number. `of: 'a'` (default) takes the unit's column of `W1a`, how it responds to `a`; `'b'` its column of `W1b`; `'out'` its row of `W2`, what it writes to each answer. With `K = floor(p / 2)`:

| Field | Shape | Meaning |
| --- | --- | --- |
| `freq` | `Int32Array(hidden)` | Each unit's dominant frequency `k`, 1 to `K`. |
| `purity` | `Float32Array(hidden)` | That frequency's share of the unit's spectral power (the constant term is left out). 1 means the column is exactly one sinusoid plus a constant. |
| `mean` | number | The mean purity. 0.18 for a fresh network, 0.88 after grokking, 0.40 after 1500 epochs without weight decay. |
| `amp`, `phase` | `Float32Array(hidden)` | The dominant sinusoid: `amp * cos(2 * pi * k * a / p + phase)`. |
| `dc` | `Float32Array(hidden)` | The constant term's share of all power. |
| `counts` | `Int32Array(K + 1)` | How many units have each dominant frequency (`counts[0]` is 0). |
| `power` | `Float32Array(K + 1)` | Each frequency's share of all units' power together. |

In the grokked default network all 20 frequencies are in use (4 to 9 units each), and every unit has the same dominant frequency over `a`, over `b` and in its output weights.

**`norms()`** -> `{ W1a, W1b, W2, total }`, Frobenius norms. The total is 7.5 at the start, 77.9 after grokking and 128 after the same time without weight decay.

### Weights in and out

| Call | What it does |
| --- | --- |
| `weights()` | `{ W1a, W1b, W2 }` as `Float32Array` copies. `W1a[a * hidden + j]`, `W1b[b * hidden + j]`, `W2[j * p + c]`. |
| `load(weights, { epoch })` | Takes `{ W1a, W1b, W2 }`, the base64 text of `encodeWeights`, or a snapshot `{ weights, epoch }`. Sets the epoch counter if given. Returns the metrics. The optimiser's moments restart from zero; that is harmless (10 epochs after loading `grokked`: 99.1% -> 99.3% test accuracy; the `memorised` snapshot trained on reaches 99% at epoch 1340, the unbroken run at 1330). |
| `TinyNet.encodeWeights(w)` | Base64 text of `W1a`, `W1b`, `W2` in that order (83,968 characters at the defaults). |
| `TinyNet.decodeWeights(text, p, hidden)` | `{ W1a, W1b, W2 }`. |
| `TinyNet.restore(snapshot)` | A trainer in the state of `{ cfg, epoch, weights }`. |

Wherever weights are an argument (`load`, `lossAt`, `gradAt`, `evalOn`, `merge`, `slice`'s `toward`), the object, the base64 text and a snapshot all work.

### Evaluating

| Call | Returns |
| --- | --- |
| `lossAt(weights, which)` | `{ loss, acc }` of any weights (`null` for the trainer's own) on `'train'`, `'test'`, `'all'` or a list of `[a, b]` pairs. `lossAt({ xy: [x, y] }, which)` evaluates a point of the last slice's plane. 3 ms on the training set. |
| `gradAt(weights, which)` | `{ loss, acc, grad: { W1a, W1b, W2 }, xy }`: the gradient of the mean loss (`Float64Array`s). `xy` is `[dLoss/dx, dLoss/dy]` along the axes of the last slice, or `null` before any slice. 6 ms on the training set. |
| `evalOn(pairs, weights)` | `{ loss, acc, n }` on a list of `[a, b]` pairs (duplicates count once). |

### Unlearning

**`unlearn({ method, forget, steps, every, lr, rule })`** changes the trainer's network and returns before and after.

| Option | Meaning |
| --- | --- |
| `forget` | Required: a list of `[a, b]` pairs. They need not all be training pairs. |
| `method: 'ascent'` | `steps` (default 30) steps up the mean loss of the forget pairs. `rule: 'adam'` (default) is Adam with the gradient's sign flipped, fresh moments and no weight decay, step size `lr` (default 0.003). `rule: 'sgd'` is the bare `w += lr * gradient` (default `lr` 1); on a grokked network it does nothing, because the loss there is about 1e-5 and so is its gradient: 100 steps changed no accuracy at `lr` up to 100, and `lr` 1000 destroyed the network within 20 steps. |
| `method: 'retrain'` | A fresh network from the same seed, trained with the same settings for `steps` epochs (default: as many as the trainer has done) on the training set minus the forget pairs. This is exact unlearning. The epoch counter restarts. Slow: a full training run. |
| `method: 'finetune'` | `steps` (default 5) more epochs of ordinary training on the training set minus the forget pairs. The epoch counter goes on. |
| `every` | Record a curve point every so many steps (default 1; 10 for retrain). Each point costs about 5 ms, more than an ascent step itself (1 ms on 40 pairs). |

Returns:

```js
{
	method, rule, steps, lr, epoch, stopped: false,
	counts: { forget, forgetInTrain, retain, test },
	before: { forget: { loss, acc, n }, retain: { loss, acc, n }, test: { loss, acc, n } },
	after:  { forget: { ... },          retain: { ... },          test: { ... } },
	curve: [{ step: 0, forget, retain, test }, ...]      // step 0 is the state the method started from
}
```

The three sets are disjoint: `forget` is every pair listed, `retain` is the training set without them, `test` is the test set without them. After `unlearn`, ordinary `step()` trains on the whole original training set again. To try several methods from the same start, keep `var w = trainer.weights()` and `trainer.load(w, { epoch: e })` in between.

What it does on the grokked default network (seed 1; 40 random training pairs as the forget set; accuracy on forget / retain / test):

| Method | Result |
| --- | --- |
| ascent, 0.003, by step | 0: 100 / 100 / 99.1 · 20: 100 / 100 / 98 · 30: 57.5 / 100 / 93.3 · 40: 15 / 100 / 80 · 50: 10 / 95 / 64 · 60: 3 / 81 / 51 |
| ascent at other step sizes | 0.001: nothing until step 60 (95 / 100 / 96). 0.01: step 10: 88 / 100 / 96, step 20: 8 / 92 / 62. 0.03: step 5: 20 / 100 / 85. |
| finetune after 30 ascent steps | The forgotten pairs come back without being trained on: 57.5% -> 88% after 1 epoch, 100% after 3. After 40 ascent steps it takes 14 epochs; after 60, 20 epochs bring back only 15%. |
| finetune alone | Nothing is forgotten: 100 / 100 / 99. |
| retrain without the 40 pairs | 39 of the 40 are still answered (test 99.6%). The network never saw them; it learned the rule. |
| retrain without all 81 pairs that contain 17 | 0 of 81 (other test pairs 97.7%). The rows of 17 in both tables only decayed. |
| ascent on fewer or more pairs, 60 steps | 1 pair: 0 / 100 / 99. 5 pairs: 0 / 100 / 91. 100 pairs: 19 / 57 / 32. |
| ascent on the `noDecay` network (memorised), 60 steps | 30 / 99 / 1: a lookup table forgets entries without touching the others. |

The `second` snapshot behaves the same (30 steps: 57 / 100 / 92). Nothing else was repeated over seeds.

**`unlearnJob(options)`** is the same in steps, for a caller that must stay responsive: `job.step(count)` advances at most `count` steps, `job.done`, `job.at`, `job.steps`, `job.curve`, `job.result` (once done), `job.stop()` (ends early; `result.stopped` is true). The worker uses it.

### Merging

**`merge(otherWeights, { align, alpha, alphas, similarity })`** -> the weights `(1 - alpha) * this + alpha * other`. The trainer's own network is not changed.

| Option | Meaning |
| --- | --- |
| `alpha` | Default 0.5. 0 is this network, 1 the other. |
| `align` | `true` first reorders the other network's hidden units to match this one's. |
| `alphas` | A list of alphas: also evaluate each one and return `curve`. |
| `similarity` | `true` also returns the matrix the matching used. |

Returns:

```js
{
	weights: { W1a, W1b, W2 },      // the merged network
	other:   { W1a, W1b, W2 },      // the other network as it was merged: permuted when align is true
	match: Int32Array(hidden),      // unit match[i] of the other network was put at position i (the identity without align)
	sign: Int8Array(hidden),        // all 1 for relu; see below
	alpha, align, matchMs,
	trainLoss, trainAcc, testLoss, testAcc,       // of the merged network, on this trainer's split
	curve: [{ alpha, trainLoss, trainAcc, testLoss, testAcc }, ...] or null,
	similarity: Float32Array(hidden * hidden) or null   // row i: this network's unit i; column j: the other's unit j
}
```

The alignment: the similarity of unit `i` here and unit `j` there is the inner product of their weights (the two incoming columns and the outgoing row together); the Hungarian algorithm finds the permutation with the largest total. For one hidden layer that is the whole of weight matching, solved exactly, in 2.4 ms for 128 units (the whole aligned `merge`, with its evaluation, 8 ms; a 21-point `alphas` curve 115 ms). Reordering hidden units does not change what a network computes (checked in `test.js`). With `act: 'square'` a unit's incoming weights may also be negated freely, and the better sign is chosen (`sign`).

`matchUnits(other, { similarity })` -> `{ match, sign, ms, similarity }` and `permuteUnits(weights, match, sign)` -> weights are the two halves.

Measured at alpha 0.5 on the snapshots (`grokked` with `second`: two seeds, the same training pairs, 1500 epochs each):

| | Train accuracy | Test accuracy |
| --- | --- | --- |
| Plain average | 75.1% | 25.9% |
| Average after alignment | 100% | 97.5% |

Test accuracy along the path at alpha 0, 0.25, 0.5, 0.75, 1: plain 99.1, 86.3, 25.9, 83.6, 99.7; aligned 99.1, 98.8, 97.5, 99.1, 99.7. Two other pairs gave plain 26.5% and 42.7%, aligned 95.4% and 99.6% (seed 1 with seed 3 on the same pairs; seed 1 with seed 2 trained on its own split). Three pairs in all. After matching, 100 of the 128 unit pairs share their dominant frequency.

### Attribution

**`influence([a, b], { kind, parts })`** -> `Float32Array(p * p)`, row `a`, column `b`: one score for every **training** pair, zero elsewhere. 6 ms.

The score of training pair `t` for query `q` is a similarity between two gradients taken at the current weights: the gradient of the loss on `t` alone and the gradient of the loss on `q` alone, each with respect to all 15,744 weights.

- `kind: 'dot'` is their inner product. It has a direct meaning: one plain gradient step of size `eta` on `t` alone changes the loss on `q` by `-eta * dot`, to first order (checked in `test.js` to 0.04%). Positive means training on `t` helps `q`.
- `kind: 'cos'`, the default, divides by both gradient norms, giving a number in [-1, 1]. Use it for display. On a trained network the raw inner products are tiny (1e-9 to 1e-7 here) and differ by orders of magnitude between pairs, because a pair's gradient norm is set by how confidently it is already answered; the cosine removes that and leaves the direction.

This is one checkpoint and no Hessian: a similarity, not an estimate of what retraining without `t` would do. Say "gradient similarity", not "influence function".

`parts: true` returns `{ total, out, a, b, kind }`: the same score split by weight matrix (`W2`, `W1a`, `W1b`). The `a` part is zero unless `t` has the same `a` as the query, and likewise `b`: a table row only gets gradient from pairs that use it.

What the scores look like on the grokked default network (four queries, cosine):

- A training pair's top score is itself, at 1.
- After that come the training pairs **with the same answer** `(a + b) mod p`: the next five (for the test-pair query, the top six) were all of that kind, at 0.16 to 0.22. Over all same-answer pairs the mean was 0.145 to 0.162, against -0.002 to -0.004 for unrelated pairs.
- Pairs that only share `a` or only share `b` score about zero on average (-0.010 to 0.009), and for each of the four queries the single lowest score (-0.066 to -0.116) belonged to such a pair.
- Roughly half of the training pairs score above zero (448 to 576 of 1009).

`test.js` asserts the first point, the bounds, the agreement of the closed form with the two full gradients, and that same-answer pairs average higher than the rest for these four queries; it prints the lists. Other seeds and other queries were not looked at.

### Loss-landscape slices

**`slice({ toward, toward2, seed, n, span, center, which, sample })`** -> the loss on an `n` by `n` grid of a plane through the current weights.

| Option | Default | Meaning |
| --- | --- | --- |
| `n` | `25` | Grid size, 2 to 201. Cost is `n * n` evaluations at about 3.3 ms each on the default network: 25 took 2.0 and 2.6 s through the worker in Chrome (4.2 and 4.5 s on a busy machine); 41 would take about 6 s. Report progress and let the reader stop it. |
| `span` | `1` | Half-width of the window in plane coordinates. |
| `center` | `[0, 0]`; `[0.5, 0]` with `toward`; with `toward2` also half of the third network's `y` | Middle of the window. |
| `seed` | `1` | Seeds the random directions. |
| `which` | `'train'` | `'train'`, `'test'`, or `'both'` (then `lossTest` and `accTest` are filled too, at 1.7 times the cost). |
| `toward` | none | Another network's weights: the x axis runs from this network to that one. |
| `toward2` | none | A third network (needs `toward`): the plane through all three. |
| `sample` | all | Evaluate on a fixed random subset of that many pairs: faster (250 pairs: 25 by 25 in 0.5 s), no longer the exact loss. |

The plane is `weights = self + x * d1 + y * d2`:

- **No `toward`**: `d1` and `d2` are random Gaussian directions, each rescaled matrix by matrix so that its part in `W1a` has the norm of `W1a`, and likewise `W1b` and `W2`. So `x = 1` means "every matrix moved by its own length". Around the grokked default network (seed 1 for the directions) the train loss is 0.001 a quarter of a unit away, 0.01 a third of a unit away, 0.3 at half a unit and 8.4 at `x = 1`, so `span: 0.5` shows the bowl and the default `span: 1` mostly its walls; draw the logarithm of the loss. The two directions are not made orthogonal; in 15,744 dimensions two random directions have a cosine of about 0.01.
- **`toward`**: `d1 = other - self` exactly, so this network is at (0, 0) and the other at (1, 0). `d2` is random, rescaled matrix by matrix to the norm of `d1`'s part there: one unit of `y` is as far as the other network, in a direction that leads nowhere in particular.
- **`toward` and `toward2`**: `d2` is the part of `toward2 - self` at right angles to `d1`, rescaled to `d1`'s length. The picture is true to scale: the third network is at `points.other2`, at its real distance and angle.

Returns:

```js
{
	n, which, span, center: [cx, cy], pairs,      // pairs: how many pairs each point was evaluated on
	loss: Float32Array(n * n), acc: Float32Array(n * n),            // loss[iy * n + ix] at (axes.x[ix], axes.y[iy])
	lossTest, accTest,                                              // Float32Array with which: 'both', else null
	axes: { x: Float32Array(n), y: Float32Array(n) },
	points: { self: [0, 0], other: [1, 0] or null, other2: [x, y] or null },
	done, total, ms, stopped: false
}
```

With the default window and an odd `n`, the middle cell is exactly this network. With `toward`, use `n = 4m + 1` (9, 13, 21, 25, 41) and both networks fall on grid points: for `n = 25`, this network is column 6 and the other column 18 of row 12.

After a slice, `lossAt({ xy: [x, y] })`, `gradAt({ xy: [x, y] })` and `planeWeights(x, y)` (-> weights) work on its plane; that is how a caller moves a point itself. `gradAt(...).xy` is the slope of the surface there, for a ball that should roll downhill. Each such call is a pass over the training set (3 ms for `lossAt`, 6 ms for `gradAt`, twice that on a busy machine), so an animation that needs a slope every frame should interpolate the grid of a finished slice and keep the exact calls for the moments that matter.

`sliceJob(options)` is the same in steps: `job.step(count)` computes at most `count` grid points, `job.done`, `job.at`, `job.total`, `job.result`, `job.stop()` (the points not reached stay `NaN`). A job keeps its own plane and its own copy of the weights it started from, so it can be stepped to the end while the network trains on or another slice is started. "The last slice" for `lossAt({ xy })`, `gradAt({ xy })` and `planeWeights` is the one started last, finished or not.

## The worker and its client

`client.js` is all a page needs. `TinyNetClient.start(workerUrl)` returns at once; every method returns a promise.

| Call | Resolves with |
| --- | --- |
| `net.ready` | (a promise, not a call) `{ version }` once the worker has loaded. Waiting for it is optional. |
| `net.init(config)` | The metrics at epoch 0 plus `{ cfg, nTrain, nTest, params }`. Starts a new trainer; a running job is stopped first. |
| `net.restore(snapshot)` | The same, for a trainer in a snapshot's state. |
| `net.train({ epochs, every, onProgress, include, until, rate })` | See below. |
| `net.stop()` | `{ stopped }`: whether a job was running. That job's own promise resolves with `stopped: true`. 30, 36 and 65 ms from call to end in three browser checks. |
| `net.busy()` | (plain boolean) whether a train, unlearn or slice call is running. |
| `net.metrics()`, `table()`, `spectrum(options)`, `norms()`, `weights()` | As in Part 2. `weights()` also carries `epoch`. These are answered in the middle of a run too. |
| `net.set({ lr, wd })` | The settings in force. Works in the middle of a run. |
| `net.load(weights, { epoch })`, `net.reset()` | The metrics. A running job is stopped first. |
| `net.unlearn({ ..., onProgress })` | The result of `unlearn`. `onProgress({ step, steps, forget, retain, test })` is called for each curve point. |
| `net.merge(other, options)`, `net.influence([a, b], options)` | As in Part 2. |
| `net.slice({ ..., onProgress })` | The result of `slice`. `onProgress({ done, total })` about every 25 ms. |
| `net.lossAt(weights, which)`, `gradAt(weights, which)`, `evalOn(pairs, weights)`, `planeWeights(x, y)` | As in Part 2. |
| `net.terminate()` | Ends the worker. Waiting calls reject. |

`net.train(options)`:

| Option | Default | Meaning |
| --- | --- | --- |
| `epochs` | `1000` | How many epochs to run. |
| `every` | `10` | `onProgress` is called whenever the epoch counter is a multiple of this, and once more at the end, so the last call always describes the final state. |
| `onProgress` | none | Called with `{ epoch, trainLoss, trainAcc, testLoss, testAcc, ran, ms, epochsPerSec }` plus what `include` asks for. |
| `include` | none | `{ table: true, spectrum: true, norms: true }` attaches `table`, `spectrum` (`'b'` or `'out'` instead of `true` picks another matrix) and `norms` to every progress message. They add under 1 ms to a report. |
| `until` | none | `{ testAcc: 0.99 }` (also `trainAcc`, `testLoss`, `trainLoss`): stop at the first progress point where every condition holds. |
| `rate` | unlimited | At most this many epochs per second, for a demo that should take the same time on every machine fast enough. |

It resolves with `{ epoch, trainLoss, trainAcc, testLoss, testAcc, ran, ms, epochsPerSec, stopped, reason }`, `reason` being `'done'`, `'until'` or `'stopped'`. The result carries no `table`; take it from the last progress message. A report evaluates all `p * p` pairs, which costs about one epoch: `every: 10` takes about a tenth of the speed, `every: 1` halves it (68 against about 140 epochs per second).

One job at a time: a second `train`, `unlearn` or `slice` while one runs rejects ("busy with train; stop() it first"). For two networks training side by side, start two clients.

Failures reject with an `Error` whose `message` is a sentence a reader can be shown ("The network could not do that: p must be an integer from 2 to 256.") and whose `detail` is the technical text. If the worker cannot start at all, `ready` and every call reject with "The training code could not be started, so nothing on this page can train." So one `.catch(function (err) { ToyKit.fail(err); ToyKit.ready(); })` is the whole failure path.

### The messages

Only for someone who talks to `worker.js` without `client.js`.

```
to the worker      { id, cmd, args }
from the worker    { id, type: 'progress', data }     zero or more, for train, unlearn, slice
                   { id, type: 'result', data }       once
                   { id, type: 'error', message }     once, instead of the result
                   { type: 'ready', version }         once, without id, when the scripts have loaded
```

| `cmd` | `args` | `data` of the result |
| --- | --- | --- |
| `init` | a `grok` config, or `{ snapshot }` | metrics + `{ cfg, nTrain, nTest, params }` |
| `train` | `{ epochs, every, include, until, rate }` | as `net.train` resolves; progress `data` as `onProgress` gets |
| `stop` | none | `{ stopped }` |
| `metrics`, `table`, `norms`, `weights`, `reset`, `ping` | none | as the methods (`ping`: `{ version, ready, busy }`) |
| `spectrum` | `{ of }` | as `spectrum()` |
| `set` | `{ lr, wd, ... }` | the settings in force |
| `load` | `{ weights, epoch }` | metrics |
| `unlearn` | the options of `unlearn` | its result; progress `{ step, steps, forget, retain, test }` |
| `merge` | `{ other, align, alpha, alphas, similarity }` | its result |
| `influence` | `{ query: [a, b], kind, parts }` | the array, or the parts object |
| `slice` | the options of `slice` | its result; progress `{ done, total }` |
| `lossAt`, `gradAt` | `{ weights, which }` or `{ xy, which }` | as the methods |
| `evalOn` | `{ pairs, weights }` | `{ loss, acc, n }` |
| `planeWeights` | `{ x, y }` | weights |

Typed arrays in results are transferred, not copied. Long jobs run in slices of 25 ms and yield to the message queue in between; `init`, `load` and `reset` stop a running job, whose promise then resolves with `stopped: true`.

## The snapshots

`window.TINYNET_SNAPSHOTS` (also `module.exports` in Node), built by `node scripts/build-grok-snapshots.mjs` and checked bit for bit by `test.js`.

| Name | What | Train / test accuracy | Mean purity |
| --- | --- | --- | --- |
| `grokked` | The default run after 1500 epochs. | 100% / 99.1% (6 of 1681 cells wrong) | 0.878 |
| `memorised` | The same run at epoch 100. | 100% / 0% | 0.366 |
| `second` | Seed 2 on the split of seed 1, 1500 epochs. For merging with `grokked`. | 100% / 99.7% | 0.863 |
| `noDecay` | The default run with `wd: 0`, 1500 epochs. | 100% / 0.6% | 0.401 |

Each is `{ about, cfg, epoch, metrics, purity, norm, weights }`: `weights` is the base64 text, `metrics` is `{ epoch, trainLoss, trainAcc, testLoss, testAcc }` to six digits. All but `memorised` also have:

- `curve: { every: 10, trainLoss, trainAcc, testLoss, testAcc }`, four arrays of 151 numbers for epochs 0, 10, ..., 1500. For `memorised`, use the first 11 points of `grokked.curve`.
- `marks: { memorised, half, grokked }`: the first recorded epoch with 100% train accuracy, with 50% test accuracy, with 99% test accuracy (-1 if never). `grokked.marks` is `{ memorised: 80, half: 370, grokked: 1330 }`.

`TINYNET_SNAPSHOTS.slices` has two 25 by 25 slices of `grokked`, each `{ about, of, n, span, center, points, x, y, train, test }` with `train[iy * 25 + ix]` and `test[...]` the two losses to four digits:

- `around`: two random directions (`slice({ n: 25, seed: 1, which: 'both' })`). A bowl: train loss 1.7e-5 in the middle, 8.4 one unit away along the x axis.
- `basins`: the plane through `grokked` at (0, 0), `second` at (1, 0) and `second` aligned to `grokked` at `points.other2` = (0.220, 0.638), window centre (0.5, 0.5). Half way to `second` the train loss is 1.13; half way to the aligned copy it is 0.004. Two networks that compute nearly the same thing, a ridge between them, and no ridge once the units are matched.

Also `TINYNET_SNAPSHOTS.version` and `.epochs` (1500).

## Measured: speed, and which settings grok

**Where and how.** One machine: Intel Core Ultra 9 386H (16 logical cores), Windows 11, Node 24.19 and headless Chrome 154. The grid below was run on 2026-10-03 while other jobs were using the same machine, so speeds moved by up to a third between runs. One thread per run. "Epoch of 99%" is the first epoch, checked every 10, at which test accuracy reached 99%; a run was stopped 300 epochs after that, or at 4000 epochs. It is given as median [lowest to highest] over the seeds 1, 2, 3, ...; where not every seed got there, the epochs are those of the seeds that did. Because the trainer is deterministic these epochs are the same on every machine; only the seconds differ.

**Checked again on 2026-10-05.** 68 of the grid's runs (18 settings, among them all ten default seeds) were repeated with the file as it now is: all 68 gave the same numbers as on 3 October, down to the last digit of the losses. The accuracies, epochs and losses quoted above for unlearning, merging, attribution, `set` and `load` were recomputed and came out the same. That day the machine was at 100% CPU with other work (16 other Node processes, four other test browsers), and everything took about twice as long: those times are given below as "busy". No measurement was made on an otherwise idle machine on either day, so read the 3 October speeds as "lightly loaded", not as a best case.

**The test suite.** `node misc/_tinynet/test.js`, 165 checks: 39.5 s on 3 October with every run in one thread (163 checks then); on the busy machine 51 to 65 s (four runs) with three of the four long runs in worker threads, which is the default, and 87 and 106 s (two runs) with `TINYNET_TEST_THREADS=0`, which trains everything in one thread. Both ways print the same results. The threaded way was not timed on a lightly loaded machine.

**The default** (p 41, hidden 128, relu, 60%, lr 0.01, wd 1), ten seeds, 2000 epochs each:

- Train accuracy reaches 100% at epoch 80 (median). For seed 1 the test accuracy is then 0%.
- Test accuracy passes 50% at epoch 370 and 99% at epoch **1090 [1000 to 1330]**. Seed 1, the default, is the slowest of the ten: 1330.
- At epoch 1500 the ten test accuracies are 99.0% to 100%; at epoch 2000, 99.7% to 100%. After passing 99% a run can dip under it again (lowest seen 98.4%).
- The rise is gradual, not a cliff: seed 1 has 4% at epoch 200, 29% at 300, 58% at 400, 78% at 500, 91% at 700, 97% at 1000.
- With `wd: 0`, five seeds, 4000 epochs: never. From epoch 10 on, the best test accuracy any of them showed was 1.8%, below the chance level of 2.4%: a network that has only memorised avoids the right answer on a new pair.

**Speed of the default.**

| | 3 October (lightly loaded) | 5 October (busy: 100% CPU) |
| --- | --- | --- |
| Node, the bare loop | 170 to 190 epochs per second (5.2 to 5.8 ms per epoch) | 86 |
| Chrome's main thread, the bare loop | as fast as Node | 92 |
| Chrome, in the worker, no reports | not recorded | 64 |
| Chrome, in the worker, a report every 10 epochs | 140 to 160 in the last measurement, 100 in the full browser check | 57 to 69; 60 and 53 in two full browser checks |
| The 1500-epoch default run through the worker | 15.0 s | 25.1 s and 28.5 s |
| Seed 1 reaches 99% (epoch 1330) | after 8.5 to 13 s | after about 22 s |
| The median seed reaches 99% (epoch 1090) | after about 7 s | after about 18 s |

No phone or slower laptop was measured: expect several times longer than the busy column, and prefer a snapshot (ready in 6 to 11 ms) to a live run where the wait is not the point. `rate` (see `net.train`) makes a run take the same time on every machine that is fast enough.

**One setting changed at a time** (everything else at the default; five seeds unless noted):

| Setting | Value | Seeds reaching 99% | Epoch of 99% | Epochs per second (Node) | Verdict |
| --- | --- | --- | --- | --- | --- |
| `lr` | 0.003 | 1 of 5 | 3570; the other four stood at 98.4 to 98.7% after 4000 | 174 | too slow |
| | 0.01 | 10 of 10 | 1090 [1000 to 1330] | 174 | default |
| | 0.02 | 10 of 10 | 720 [600 to 930] | | good |
| | 0.03 | 10 of 10 | 610 [520 to 780] | | good: the fast choice |
| | 0.05 | 10 of 10 | 500 [450 to 630] | | good |
| | 0.1 | 10 of 10 | 380 [360 to 540] | | good, top of the safe range |
| | 0.3 | 3 of 5 | 1100, 1180, 1180; the other two peaked at 85% and 94% | | unstable |
| | 1 | 0 of 5 | never (does not even fit the training set) | | broken |
| `wd` | 0 | 0 of 5 | never (best 1.8%) | 174 | the "no grokking" control |
| | 0.1 | 0 of 5 | not in 4000 (best 85 to 94%) | | too slow |
| | 0.3 | 5 of 5 | 2280 [2240 to 2840] | | slow |
| | 0.5 | 5 of 5 | 1440 [1250 to 1700] | | good |
| | 0.7 | 5 of 5 | 1160 [1070 to 1420] | | good |
| | 1 | 10 of 10 | 1090 [1000 to 1330] | | default |
| | 1.5 | 5 of 5 | 1720 [1200 to 1860] | | slow |
| | 2 | 0 of 5 | stalls at 97 to 98.7% | | never 99% |
| | 3 | 0 of 5 | stalls near 80% | | no |
| | 5 | 0 of 5 | best 42%; does not fit the training set | | no |
| `frac` | 0.3 | 0 of 5 | never (best 0.7%) | 349 | no |
| | 0.4 | 0 of 5 | best 57 to 71% | | no |
| | 0.5 | 0 of 5 | stalls at 96 to 98.7% | | never 99% (works with lr 0.03: 1200 [1020 to 1240]) |
| | 0.6 | 10 of 10 | 1090 [1000 to 1330] | 174 | default |
| | 0.7 | 5 of 5 | 600 [580 to 850] | | good |
| | 0.8 | 5 of 5 | 410 [380 to 430] | 138 | good |
| | 0.9 | 5 of 5 | 320 [270 to 510] | | good, but little left to test on |
| `hidden` | 32 | 0 of 5 | best 49 to 57% | | no |
| | 64 | 0 of 5 | stalls near 85% | 310 | no |
| | 96 | 0 of 5 | stalls at 96 to 98.5% | | never 99% |
| | 128 | 10 of 10 | 1090 [1000 to 1330] | 174 | default |
| | 192 | 5 of 5 | 710 [700 to 830] | | good |
| | 256 | 5 of 5 | 530 [490 to 590] | 91 | good: fewer epochs, the same seconds |
| `p` | 11 | 0 of 5 | never (best 2%) | | no |
| | 17 | 0 of 5 | best 31 to 40% | | no |
| | 23 | 0 of 5 | best 80 to 93% | 817 | no (yes with `square`) |
| | 31 | 5 of 5 | 1830 [1330 to 2420] | 390 | good: about 5 s |
| | 37 | 5 of 5 | 1330 [1280 to 1980] | | good |
| | 41 | 10 of 10 | 1090 [1000 to 1330] | 174 | default: about 6 s |
| | 47 | 5 of 5 | 1170 [870 to 1400] | | good |
| | 53 | 5 of 5 | 920 [790 to 980] | 87 | slowish: about 11 s |
| | 59 | 5 of 5 | 860 [690 to 960] | 55 | slow: about 16 s |
| | 97 | 2 of 2 | 440, 630 | 16 | too slow: 30 to 40 s |
| `act` | `relu` | 10 of 10 | 1090 [1000 to 1330] | 174 | default |
| | `square` | 5 of 5 | 180 [180 to 200] | 117 | very fast (1.5 s), but only 130 epochs after the training set is fitted (epoch 50): less of a wait to watch |
| | `tanh` | 0 of 5 | stalls at 83 to 88% | | no |
| | `sigmoid` | 0 of 5 | never (best 1.5%) | | no |
| | `linear` | 0 of 2 | never; cannot even fit the training set | | no |
| `init` | 0.5, 2, 4 | 5 of 5 each | 1200, 1120, 1150 | | makes no difference: do not offer it |
| `beta2` | 0.95 | 5 of 5 | 1260 [920 to 1740] | | no gain |
| | 0.999 | 4 of 5 | 2560, 2630, 3600, 3640; one seed not within 4000 (best 98.2%) | | slow |

The speed column is filled where it was measured (3 October); it depends on `p`, `hidden`, `frac` and `act` and not on the other settings. On the busy machine of 5 October the bare loop gave, in Node and in Chrome's worker: default 86 and 64 epochs per second; `square` 45 and 43; `p` 31, 160 and 128; `p` 59, 23 and 22; `hidden` 64, 126 and 108; `hidden` 256, 37 and 30. The verdicts "about 5 s" and the like are for the lightly loaded machine: double them for a busy one.

**With `act: 'square'`** (five seeds each): `lr 0.03` 100 [100 to 190]; `wd 0.3` 420 [410 to 570]; `wd 0` never (best 48%); `hidden 64` 310 [290 to 510]; `hidden 32` stalls at 94 to 97%; `frac 0.4` 810 [690 to 910]; `frac 0.3` 1430 [1370 to 1490]; `p 23` 620 [540 to 700]; `p 31` 320 [260 to 400]; `p 59` 140 [130 to 160] at 41 epochs per second; `p 97` 120 (two seeds) at 9 epochs per second, about 13 s.

**Sliders a toy can safely expose** (relu, the other settings at their defaults):

| Slider | Safe range | Outside it |
| --- | --- | --- |
| learning rate | 0.01 to 0.1 | below: minutes; above: unstable |
| weight decay | 0.5 to 1 for grokking within 1700 epochs; 0 as the control | 0.1 and less: not within 4000 epochs; 2 and more: never reaches 99% |
| training share | 0.6 to 0.9 | 0.5 stalls just under 99%; 0.4 and less never generalises |
| hidden units | 128 to 256 | 96 stalls just under 99%; 64 and less fails |
| p | 31 to 53 | 23 and less fails; 59 and more is slow |
| activation | relu, square | tanh, sigmoid and linear do not grok |
| seed | any | ten of ten worked |

Combinations were not searched, apart from `lr 0.03` with `frac 0.5` (works), with `p 31` (960 [800 to 1180]), with `hidden 64` (still fails) and with `p 23` (still fails). A toy that offers two sliders at once should say that a combination may not grok, and should always offer a way back to the defaults.

**Other costs** (default network, Chrome's main thread; Node was within a tenth): `restore` 6 ms; `metrics()` 5 ms; `spectrum()` 0.3 ms; `influence` 6 ms; `merge` 5 ms, 8 ms with alignment (the matching itself 2.4 ms); `lossAt` on the training set 3 ms, `gradAt` 6 ms; a slice point 3.2 ms (5.4 ms with `which: 'both'`, 0.8 ms with `sample: 250`); 30 ascent steps on 40 pairs 31 ms; 5 fine-tuning epochs 72 ms; `retrain` is a whole training run. Through the worker add a millisecond or two per call, and 10 to 20 ms the first time a function runs. One training step of a generic 2-16-16-2 tanh network on 200 points: 0.3 ms.

The same on the busy machine of 5 October, Chrome's main thread: `restore` 11 ms (38 ms the first time); `metrics()` 9 ms; `spectrum()` 0.5 ms; `influence` 11 ms; `merge` 9 ms, 13 ms with alignment (the matching 4 ms; a 21-point `alphas` curve 193 ms); `lossAt` 8 ms, `gradAt` 15 ms; a slice point 6.9 ms (10.7 ms with `which: 'both'`, 2.2 ms with `sample: 250`); 30 ascent steps 53 ms (431 ms with a curve point per step); 5 fine-tuning epochs 169 ms; a generic training step 0.7 ms. Through the worker that day: `restore` 31 ms, `influence` 27 ms, an aligned `merge` 64 ms, a 25 by 25 slice 4.2 s (1.1 s with `sample: 250`).

## Determinism

`tinynet.js` never calls `Math.random`, and training uses only `+ - * /` and `Math.sqrt` on IEEE doubles: `exp` and `log` are implemented in the file because `Math.exp` and `Math.log` are allowed to differ between engines. Weights are stored as `Float32Array`, so `weights()` is the whole state of the network and a snapshot is exact.

Checked, on 3 October and again on 5 October: the default run in headless Chrome 154 (through the worker) gave the same 15,744 weights, bit for bit (0 of 15,744 differ), and the same metric curve as Node 24 after 1500 epochs. A lighter check on six settings (the default, `square`, `p` 31, `p` 59, `hidden` 64, `hidden` 256; 220 to 420 epochs; three runs each) compared three sampled weights and the training loss between Node and the worker: equal to the last bit every time. And on 5 October every other client call (`load`, `set`, `until`, the three `unlearn` methods, `merge`, `influence`, `slice` and the plane calls, `lossAt`, `gradAt`, `evalOn`, `spectrum`, `norms`, `table`, `reset`) was made once through the real worker on a small network (`p` 23, `hidden` 48) and compared with the same call on the page's own `TinyNet`: every number and every array equal. So the numbers above ("99% at epoch 1330 for seed 1") hold for every visitor with such an engine, and a snapshot is exactly the state a live run reaches. Not checked: Firefox, Safari, any phone, any ARM processor. They should agree, since nothing engine-specific is used and every operation is one IEEE operation, but nobody has run them. A toy must not depend on it: compare with a tolerance, or read the state from the worker.

Two things are outside this promise: `spectrum()` uses `Math.cos` and `Math.sin`, so its numbers may differ in the last digits between engines; and `ms` fields are clock readings.

## Limits and things to know

- One hidden layer, no biases, full batch. It is not a transformer; `misc/07-grokking-microscope` shows a recorded one.
- "Grokking" here is delayed generalisation on a 1,681-pair task in about a thousand steps. The curve rises over hundreds of epochs; it is not the sharp late jump of the long runs in the literature.
- `p` up to 256 is accepted but untested above 97.
- A learning rate that is too high can end in `NaN` losses; the trainer does not stop by itself. `metrics()` then reports `NaN`.
- `load()` restarts the optimiser's moments (harmless, see above); there is no way to save them.
- The generic network has no worker; it is meant for networks small enough for the page's own thread.
- The unlearning, merging and attribution numbers come from one or two seeds, as stated next to each.

## Licences

The kit is the site's own code. `exp` and `log` follow fdlibm's `e_exp.c` and `e_log.c` (Sun Microsystems, 1993: "Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved"; the notice is in `tinynet.js`). The random generator is mulberry32 (Tommy Ettinger, public domain) on an FNV-1a hash (public domain). No data is vendored: `snapshots.js` is generated from `tinynet.js`.
