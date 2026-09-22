"""Analyze every checkpoint and build the visualization page.

For each checkpoint in checkpoints/ this computes
  - train and test loss and accuracy,
  - the attention pattern of each head, for 8 fixed example pairs and
    averaged over all p*p pairs, plus the attention from "=" to the a token
    as a function of a (averaged over b), which becomes periodic after grokking,
  - the Fourier spectrum of the token embedding over Z_p, and likewise for
    the unembedding and for the MLP neuron activations,
  - the predictions on the 8 example pairs and the total weight norm.

Everything is rounded to 3 decimals and written to viz/frames.json, then
inlined into viz/template.html to produce the self-contained viz/index.html.

Usage:
    python3 analyze.py                          # after train.py
    python3 analyze.py --ckpt-dir other/run     # analyze a different run
"""

import argparse
import json
import math
import os
import re

import numpy as np
import torch

from train import CKPT_DIR as DEFAULT_CKPT_DIR, GrokTransformer, make_dataset

HERE = os.path.dirname(os.path.abspath(__file__))
VIZ_DIR = os.path.join(HERE, "viz")
N_EXAMPLES = 8


def fourier_basis(p):
    """Orthonormal real Fourier basis over Z_p as a (p, p) matrix.

    Row 0 is the constant. Rows 2k-1 and 2k are cos and sin at frequency k
    for k = 1 .. (p-1)/2. freq_of_row maps each row to its frequency k.
    """
    x = np.arange(p)
    rows = [np.full(p, 1 / math.sqrt(p))]
    freq_of_row = [0]
    for k in range(1, (p - 1) // 2 + 1):
        rows.append(math.sqrt(2 / p) * np.cos(2 * math.pi * k * x / p))
        rows.append(math.sqrt(2 / p) * np.sin(2 * math.pi * k * x / p))
        freq_of_row += [k, k]
    return np.stack(rows), np.array(freq_of_row)


def spectrum_1d(matrix, basis, freq_of_row):
    """Normalized norm per frequency of a (p, d) matrix along its first axis.

    Returns a list of length (p+1)/2 whose squares sum to 1, so each entry is
    the fraction of the matrix norm living at that frequency (as a norm).
    """
    coef = basis @ matrix  # (p, d)
    energy_per_row = (coef ** 2).sum(1)
    n_freq = freq_of_row.max() + 1
    energy = np.zeros(n_freq)
    np.add.at(energy, freq_of_row, energy_per_row)
    total = energy.sum()
    return np.sqrt(energy / total) if total > 0 else energy


def spectrum_2d_neurons(act, basis, freq_of_row):
    """Neuron activations as functions of (a, b): energy per frequency.

    act has shape (p, p, n_neurons). Each neuron is transformed over both
    inputs; a 2D coefficient at rows (i, j) is assigned to the frequency
    max(freq(i), freq(j)). The constant term (mean activation) is dropped
    so the spectrum shows structure rather than the bias of the ReLU.
    """
    coef = np.einsum("ia,abn->ibn", basis, act)
    coef = np.einsum("jb,ibn->ijn", basis, coef)
    energy_2d = (coef ** 2).sum(2)  # (p, p)
    energy_2d[0, 0] = 0.0
    freq_2d = np.maximum(freq_of_row[:, None], freq_of_row[None, :])
    n_freq = freq_of_row.max() + 1
    energy = np.zeros(n_freq)
    np.add.at(energy, freq_2d.ravel(), energy_2d.ravel())
    total = energy.sum()
    return np.sqrt(energy / total) if total > 0 else energy


def r3(x):
    """Round a number, list or array to 3 decimals for compact JSON."""
    if isinstance(x, (float, np.floating)):
        return round(float(x), 3)
    if isinstance(x, np.ndarray):
        return [r3(v) for v in x.tolist()]
    if isinstance(x, (list, tuple)):
        return [r3(v) for v in x]
    return x


def analyze_checkpoint(path, cfg, data, basis, freq_of_row, examples):
    (tr_x, tr_y), (te_x, te_y), (all_x, all_y) = data
    ck = torch.load(path, map_location="cpu", weights_only=False)
    model = GrokTransformer(cfg["p"], cfg["d_model"], cfg["n_heads"], cfg["d_mlp"])
    model.load_state_dict(ck["state_dict"])
    model.eval()
    p = cfg["p"]

    with torch.no_grad():
        frame = {"epoch": ck["epoch"]}
        for name, x, y in (("train", tr_x, tr_y), ("test", te_x, te_y)):
            logits = model(x)
            frame[f"{name}_loss"] = r3(torch.nn.functional.cross_entropy(logits, y).item())
            frame[f"{name}_acc"] = r3((logits.argmax(-1) == y).float().mean().item())

        # Attention over the full p*p grid: mean 3x3 per head, and the weight
        # the "=" query puts on the a token as a function of a.
        logits, internals = model(all_x, return_internals=True)
        pattern = internals["pattern"]  # (p*p, H, 3, 3)
        frame["attn_mean"] = r3(pattern.mean(0).numpy())
        to_a = pattern[:, :, 2, 0].reshape(p, p, -1).mean(1)  # (p, H): avg over b
        frame["attn_to_a_by_a"] = r3(to_a.T.numpy())
        frame["weight_norm"] = r3(math.sqrt(sum((w ** 2).sum().item() for w in model.parameters())))

        # The 8 fixed example pairs: full attention pattern and prediction.
        ex_idx = examples["index"]
        frame["attn_examples"] = r3(pattern[ex_idx].numpy())  # (8, H, 3, 3)
        frame["example_pred"] = logits[ex_idx].argmax(-1).tolist()

        # Fourier spectra.
        W_E = model.embed.weight[:p].numpy()          # (p, d), rows are tokens
        W_U = model.unembed.weight.numpy()            # (p, d), rows are outputs
        frame["fourier_embed"] = r3(spectrum_1d(W_E, basis, freq_of_row))
        frame["fourier_unembed"] = r3(spectrum_1d(W_U, basis, freq_of_row))
        act = internals["act"].numpy().reshape(p, p, -1)
        frame["fourier_neurons"] = r3(spectrum_2d_neurons(act, basis, freq_of_row))
    return frame


def build_page(frames_json):
    """Inline the JSON into the template so the page opens from file://."""
    with open(os.path.join(VIZ_DIR, "template.html"), encoding="utf-8") as f:
        template = f.read()
    safe = frames_json.replace("</", "<\\/")  # never close the script tag early
    marker = "/*__FRAMES_JSON__*/null"
    assert marker in template, "template.html is missing the frames marker"
    page = template.replace(marker, safe, 1)
    out = os.path.join(VIZ_DIR, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ckpt-dir", default=DEFAULT_CKPT_DIR,
                    help="folder with ckpt_*.pt and log.json (default: checkpoints/)")
    ap.add_argument("--no-page", action="store_true", help="write frames.json only")
    args = ap.parse_args()
    CKPT_DIR = args.ckpt_dir
    with open(os.path.join(CKPT_DIR, "log.json")) as f:
        run = json.load(f)
    cfg = run["config"]
    p = cfg["p"]

    (tr_x, tr_y), (te_x, te_y) = make_dataset(p, cfg["frac"], cfg["seed"])
    # Every pair in (a, b) row-major order, so index a*p + b is the pair (a, b).
    a = torch.arange(p).repeat_interleave(p)
    b = torch.arange(p).repeat(p)
    all_x = torch.stack([a, b, torch.full_like(a, p)], 1)
    data = ((tr_x, tr_y), (te_x, te_y), (all_x, (a + b) % p))

    # Fixed examples: the first 8 held-out pairs of the split. They are all
    # wrong while the model only memorizes and all right after it groks.
    ex_tokens = te_x[:N_EXAMPLES]
    examples = {
        "a": ex_tokens[:, 0].tolist(), "b": ex_tokens[:, 1].tolist(),
        "answer": te_y[:N_EXAMPLES].tolist(),
        "index": (ex_tokens[:, 0] * p + ex_tokens[:, 1]).tolist(),
    }

    basis, freq_of_row = fourier_basis(p)
    paths = sorted(f for f in os.listdir(CKPT_DIR) if re.fullmatch(r"ckpt_\d+\.pt", f))
    frames = []
    for i, name in enumerate(paths):
        frame = analyze_checkpoint(os.path.join(CKPT_DIR, name), cfg, data,
                                   basis, freq_of_row, examples)
        frames.append(frame)
        print(f"[{i + 1}/{len(paths)}] epoch {frame['epoch']:6d}  "
              f"train acc {frame['train_acc']:.3f}  test acc {frame['test_acc']:.3f}  "
              f"top embed freq {int(np.argmax(frame['fourier_embed']))}", flush=True)

    curve = [{k: r3(v) if isinstance(v, float) else v for k, v in row.items()}
             for row in run["log"]]
    out = {
        "config": {k: cfg[k] for k in ("p", "frac", "seed", "wd", "lr", "d_model",
                                       "n_heads", "d_mlp", "epochs")},
        "grok_epoch": run.get("grok_epoch"),
        "elapsed_seconds": r3(run.get("elapsed_seconds", 0.0)),
        "n_train": len(tr_y), "n_test": len(te_y),
        "examples": {k: examples[k] for k in ("a", "b", "answer")},
        "curve": curve,
        "frames": frames,
    }
    os.makedirs(VIZ_DIR, exist_ok=True)
    frames_json = json.dumps(out, separators=(",", ":"))
    with open(os.path.join(VIZ_DIR, "frames.json"), "w") as f:
        f.write(frames_json)
    print(f"wrote viz/frames.json ({len(frames_json) / 1e6:.2f} MB)")
    if not args.no_page:
        print(f"wrote {build_page(frames_json)}")


if __name__ == "__main__":
    main()
