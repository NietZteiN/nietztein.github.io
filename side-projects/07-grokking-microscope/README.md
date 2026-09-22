# Tiny transformer under a microscope

A one-layer transformer (4 heads, d_model 128, MLP 512) learns `a + b mod 113` from 30 percent of all input pairs, with full-batch AdamW and weight decay 1.0. It memorizes the training set within a few hundred epochs, sits on a plateau, and then groks: test accuracy jumps from near chance to above 99 percent around epoch 3950. `train.py` saves checkpoints along the way, `analyze.py` computes loss curves, attention patterns and the Fourier spectrum of the embeddings at every checkpoint, and writes a single self-contained page, `viz/index.html`, with a slider over training. The generated page is committed, so the visualization opens without training anything.

## How to run

```
cd 07-grokking-microscope
pip install -r requirements.txt        # torch (CPU is fine) and numpy
python3 train.py                       # 7 to 13 minutes on 4 CPU cores, stops on its own
python3 analyze.py                     # writes viz/frames.json and viz/index.html
```

Then open `viz/index.html` directly in a browser (file:// works, nothing is fetched), or serve the repository with `python3 -m http.server` and browse to it.

Flags for `train.py`: `--p`, `--frac`, `--epochs`, `--seed`, `--wd`, `--lr`, `--d-model`, `--n-heads`, `--d-mlp`, `--ckpt-every`, `--patience`, `--threads`. Training stops once test accuracy has stayed above 99 percent for 200 epochs, so `--epochs` (default 8000) is only an upper bound. Progress is printed every 100 epochs.

`analyze.py --ckpt-dir some/other/run` analyzes a different checkpoint folder. `python3 check_page.py` (needs `pip install playwright` and a Chromium build) opens the page headlessly, reports console errors and saves `screenshot.png`.

In the page: space plays and pauses, the left and right arrow keys step one frame, shift with an arrow steps ten frames, home and end jump to the first and last frame. Clicking on a curve jumps to the nearest checkpoint. There is no GIF export; step with the keys and take screenshots instead.

## What is measured

With the default settings the run takes 7 to 13 minutes on this machine (4 cores, about 0.1 seconds per full-batch epoch) and stops at epoch 4150. Train accuracy reaches 100 percent by epoch 200. Test accuracy first passes 99 percent at epoch 3950: it creeps from 10 percent at epoch 400 to 30 percent at epoch 2500, then climbs to 99 percent by epoch 3950. The total weight norm rises from 37 to 58 during memorization and falls to 43 by the end, which is weight decay doing its work. Checkpoints are saved every 80 epochs and additionally whenever train or test accuracy has moved by 5 points since the last save, which puts more frames in the two transitions; the default run gives 66 frames.

For every checkpoint the page shows

- train and test loss (log scale) and accuracy, with a cursor on the full curve logged every 10 epochs,
- for each head, the mean attention pattern over all p*p pairs, the pattern of the `=` query on eight fixed held-out pairs, and the attention paid to `a` as a function of `a` (averaged over `b`), which becomes periodic after grokking,
- the Fourier spectrum over Z_p of the token embedding (norm per frequency, normalized so the squares sum to 1), with toggles for the unembedding and for the MLP neuron activations as functions of both inputs,
- the eight examples with the model's prediction, and the total weight norm.

## File layout

```
train.py           model, data split, training loop, checkpoint policy
analyze.py         per-checkpoint analysis, writes viz/frames.json and builds viz/index.html
check_page.py      optional headless check of the page with Playwright, writes screenshot.png
viz/template.html  the page, with a marker where analyze.py inlines the JSON
viz/index.html     generated, self-contained page for the committed run (about 0.6 MB)
viz/frames.json    generated data behind the page
screenshot.png     the page at the first checkpoint past 99 percent test accuracy
checkpoints/       gitignored; ckpt_*.pt and log.json from the last run
requirements.txt
```

## Assumptions

- The model has no LayerNorm and no biases. This keeps the token embedding a plain matrix whose rows can be projected onto the Fourier basis directly. Weights are initialized as normal with standard deviation 1/sqrt(fan_in).
- Attention is causal. Only the last position (the `=` token) produces a prediction, so in the 3x3 patterns only the last row matters.
- The eight example pairs are the first eight held-out pairs of the seeded split. They are chosen from the test set so that they go from wrong to right during grokking.
- The Fourier spectrum of the neuron activations assigns each 2D coefficient at (frequency i, frequency j) to max(i, j) and drops the constant term. The embedding and unembedding spectra keep the constant term (k = 0).
- Checkpoints are kept out of git. The committed `viz/index.html` and `viz/frames.json` come from the default run (seed 0). Rerunning `train.py` then `analyze.py` overwrites both.
- Colors in the page: train is blue, test is orange, and heatmaps use a single blue ramp from the panel color to light blue.

## Ideas for later

- A p x p heatmap per head of the attention to `a` over all (a, b), to see the two-dimensional periodicity.
- Per-neuron spectra: cluster the 512 MLP neurons by their dominant frequency and show how many neurons each frequency owns over training.
- Progress measures from the interpretability literature: restrict the logits to the top frequencies and plot the loss of that restricted model, which drops before the test loss does.
- Compare seeds or weight decay values side by side, since the set of key frequencies changes from run to run.
- A two-layer variant with a flag, to see whether the same structure appears.
