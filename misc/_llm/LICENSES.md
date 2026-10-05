# Licences

What this folder holds that somebody else made. Everything else in it (`llm.js`, `worker.js`, `client.js`, `test.js`, `build-fetch-weights.mjs`, the documents) was written for this site.

## The weights: stories260K

| | |
| --- | --- |
| What | A Llama-2-shaped transformer of 260,032 parameters trained on the TinyStories dataset, and the 512-token tokenizer trained with it. |
| Author | Andrej Karpathy |
| Repository | https://huggingface.co/karpathy/tinyllamas (folder `stories260K`) |
| Revision | `0bd21da7698eaf29a0d7de3992de8a46ef624add` (the head of `main`, last changed 2023-08-15) |
| Licence | MIT |
| Fetched | 2026-10-03, by `build-fetch-weights.mjs` |
| Changed | Nothing. The two files are byte for byte what the repository serves. |

| File | Bytes | SHA-256 | Fetched from |
| --- | --- | --- | --- |
| `weights/stories260K.bin` | 1,056,540 | `b0a507e7ad0f626624f17112325e66691f9076d622e1d3274d103d00299f2696` | https://huggingface.co/karpathy/tinyllamas/resolve/0bd21da7698eaf29a0d7de3992de8a46ef624add/stories260K/stories260K.bin |
| `weights/tok512.bin` | 6,227 | `037cb335abb25d1fa9e8ecae30ed2a3a8ace9302862ebcdc05d51a6bbb10c312` | https://huggingface.co/karpathy/tinyllamas/resolve/0bd21da7698eaf29a0d7de3992de8a46ef624add/stories260K/tok512.bin |

Both hashes equal the ones the repository itself lists for the files (their Git LFS object ids), and `node misc/_llm/build-fetch-weights.mjs --check` and `node misc/_llm/test.js` both verify them against the files on disk.

**Where the licence is stated.** The repository has no licence file; it states the licence in two places, both read on 2026-10-03:

- The model card, `README.md` at the root of the repository, opens with the metadata block

  ```
  ---
  license: mit
  ---
  ```

  followed by its one sentence: "This is a Llama 2 architecture model series trained on the TinyStories dataset, intended for use in the [llama2.c](https://github.com/karpathy/llama2.c) project."
- The Hub's own record of the repository (`https://huggingface.co/api/models/karpathy/tinyllamas`) carries the tag `license:mit` and `"cardData":{"license":"mit"}`. The model page shows this as "License: mit".

The model card does not carry a copyright line of its own. The credit to give is: stories260K by Andrej Karpathy, from karpathy/tinyllamas on Hugging Face, MIT.

**How it was trained** (from `stories260K/readme.md` in the same repository): `dim=64, n_layers=5, n_heads=8, n_kv_heads=4, multiple_of=4, vocab_size=512, max_seq_len=512, dropout=0.05`, 100,000 iterations at batch size 128, "achieves validation loss of 1.2968". The same file gives the text the model prints when it always takes the most likely token; `test.js` reproduces that text exactly.

**The training data** is not in this folder. TinyStories (Ronen Eldan and Yuanzhi Li, "TinyStories: How Small Can Language Models Be and Still Speak Coherent English?", arXiv:2305.07759) is published at https://huggingface.co/datasets/roneneldan/TinyStories under CDLA-Sharing-1.0 (the dataset's tag on 2026-10-03).

**To rebuild:** `node misc/_llm/build-fetch-weights.mjs` downloads both files from the pinned revision, refuses anything whose size or SHA-256 differs from the table above, and writes `weights/`. It identifies itself as `nietztein.github.io weights fetch (+https://nietztein.github.io)` and sends no email address. No page of the site ever contacts huggingface.co: the browser loads the copies in `weights/`.

## The arithmetic: run.c from llama2.c

`llm.js` contains no code copied from elsewhere, but its forward pass and its tokenizer are a JavaScript port of `run.c` in https://github.com/karpathy/llama2.c (read on 2026-10-03 at the head of `master`, commit `350e04fe35433e6d2941dce5a1f53308f87058eb`; `run.c` last changed in `2fbf7059aab6f7e44047da1ff5c0ba53057a248e`). The checkpoint layout, RMSNorm, the rotary position encoding, the grouped key/value heads, the SwiGLU feed-forward and the greedy merge loop of the tokenizer follow that file step by step. It is under the MIT licence, which asks that this notice travel with it:

```
MIT License

Copyright (c) 2023 Andrej

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

What differs from `run.c`: sums are accumulated in double precision and stored in single (the C program accumulates in single); sampling uses a different random generator and top-k instead of top-p; decoding does not drop unprintable bytes. Both samples in `stories260K/readme.md` are reproduced by `test.js`, 256 tokens each: the one that always takes the most likely token, and the one drawn at temperature 1.0 with top-p 0.9 and seed 133742 (for which the test rebuilds `run.c`'s sampler on top of this code's scores).

## A line for a page's footer

> The model is stories260K by Andrej Karpathy (MIT), trained on TinyStories (Eldan and Li, 2023), from huggingface.co/karpathy/tinyllamas; the arithmetic follows his llama2.c. The site serves its own copy of the weights.
