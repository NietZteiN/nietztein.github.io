"""Train a one-layer transformer on modular addition and save checkpoints.

Task: given tokens [a, b, =], predict (a + b) mod p at the last position.
The model is trained on a random fraction of all p*p pairs with full-batch
AdamW and strong weight decay. With these settings it first memorizes the
training set and, much later, suddenly generalizes to the held-out pairs.
That delayed jump is what people call grokking.

Usage:
    python3 train.py                      # defaults: p=113, frac=0.3, seed=0
    python3 train.py --epochs 8000 --wd 1.0 --seed 1

Checkpoints go to checkpoints/ (gitignored). A training log with the
loss and accuracy curve is written to checkpoints/log.json. analyze.py
reads both.
"""

import argparse
import json
import math
import os
import time

import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
CKPT_DIR = os.path.join(HERE, "checkpoints")


# ----------------------------------------------------------------------------
# Model
# ----------------------------------------------------------------------------

class Attention(nn.Module):
    """Multi-head causal self-attention with no biases.

    forward() also returns the attention pattern so analyze.py can plot it.
    """

    def __init__(self, d_model, n_heads):
        super().__init__()
        self.n_heads = n_heads
        self.d_head = d_model // n_heads
        self.q = nn.Linear(d_model, d_model, bias=False)
        self.k = nn.Linear(d_model, d_model, bias=False)
        self.v = nn.Linear(d_model, d_model, bias=False)
        self.o = nn.Linear(d_model, d_model, bias=False)

    def forward(self, x):
        B, T, D = x.shape
        H, dh = self.n_heads, self.d_head
        q = self.q(x).view(B, T, H, dh).transpose(1, 2)  # B H T dh
        k = self.k(x).view(B, T, H, dh).transpose(1, 2)
        v = self.v(x).view(B, T, H, dh).transpose(1, 2)
        scores = q @ k.transpose(-1, -2) / math.sqrt(dh)  # B H T T
        mask = torch.triu(torch.ones(T, T, dtype=torch.bool, device=x.device), 1)
        scores = scores.masked_fill(mask, float("-inf"))
        pattern = scores.softmax(-1)
        out = (pattern @ v).transpose(1, 2).reshape(B, T, D)
        return self.o(out), pattern


class GrokTransformer(nn.Module):
    """One transformer block: embed, attention, MLP, unembed. No LayerNorm.

    Leaving out LayerNorm and biases keeps the learned weights easy to read:
    the token embedding is a plain p x d_model matrix whose rows can be
    projected onto the Fourier basis over Z_p without any correction.
    """

    def __init__(self, p, d_model=128, n_heads=4, d_mlp=512, n_ctx=3):
        super().__init__()
        self.p = p
        self.embed = nn.Embedding(p + 1, d_model)  # tokens 0..p-1 plus "="
        self.pos = nn.Parameter(torch.zeros(n_ctx, d_model))
        self.attn = Attention(d_model, n_heads)
        self.mlp_in = nn.Linear(d_model, d_mlp, bias=False)
        self.mlp_out = nn.Linear(d_mlp, d_model, bias=False)
        self.unembed = nn.Linear(d_model, p, bias=False)
        self._init_weights()

    def _init_weights(self):
        # Normal init scaled by 1/sqrt(fan_in) for every matrix. This is the
        # scale used in the original grokking reproductions; the default
        # PyTorch Embedding init (std 1) is much larger and slows things down.
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, std=1.0 / math.sqrt(m.in_features))
        nn.init.normal_(self.embed.weight, std=1.0 / math.sqrt(self.embed.embedding_dim))
        nn.init.normal_(self.pos, std=1.0 / math.sqrt(self.pos.shape[1]))

    def forward(self, tokens, return_internals=False):
        x = self.embed(tokens) + self.pos[None, : tokens.shape[1]]
        attn_out, pattern = self.attn(x)
        x = x + attn_out
        pre = self.mlp_in(x)
        act = F.relu(pre)
        x = x + self.mlp_out(act)
        logits = self.unembed(x[:, -1])  # only the last position predicts
        if return_internals:
            return logits, {"pattern": pattern, "act": act[:, -1]}
        return logits


# ----------------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------------

def make_dataset(p, frac, seed):
    """All p*p pairs as [a, b, =] token rows, split with a seeded permutation.

    The same (p, frac, seed) always gives the same split, so analyze.py can
    rebuild it from the config stored with each checkpoint.
    """
    a = torch.arange(p).repeat_interleave(p)
    b = torch.arange(p).repeat(p)
    eq = torch.full_like(a, p)
    tokens = torch.stack([a, b, eq], 1)
    labels = (a + b) % p
    g = torch.Generator().manual_seed(seed)
    perm = torch.randperm(p * p, generator=g)
    n_train = int(frac * p * p)
    train_idx, test_idx = perm[:n_train], perm[n_train:]
    return (tokens[train_idx], labels[train_idx]), (tokens[test_idx], labels[test_idx])


# ----------------------------------------------------------------------------
# Training
# ----------------------------------------------------------------------------

def evaluate(model, tokens, labels):
    with torch.no_grad():
        logits = model(tokens)
        loss = F.cross_entropy(logits, labels).item()
        acc = (logits.argmax(-1) == labels).float().mean().item()
    return loss, acc


def save_checkpoint(model, epoch, config, metrics):
    path = os.path.join(CKPT_DIR, f"ckpt_{epoch:06d}.pt")
    torch.save({"epoch": epoch, "config": config, "metrics": metrics,
                "state_dict": model.state_dict()}, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--p", type=int, default=113, help="modulus (prime)")
    ap.add_argument("--frac", type=float, default=0.3, help="training fraction of all pairs")
    ap.add_argument("--epochs", type=int, default=8000, help="maximum number of epochs")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--wd", type=float, default=1.0, help="AdamW weight decay")
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--d-model", type=int, default=128)
    ap.add_argument("--n-heads", type=int, default=4)
    ap.add_argument("--d-mlp", type=int, default=512)
    ap.add_argument("--eval-every", type=int, default=10,
                    help="epochs between test-set evaluations (also the log resolution)")
    ap.add_argument("--ckpt-every", type=int, default=80,
                    help="regular checkpoint interval in epochs")
    ap.add_argument("--patience", type=int, default=200,
                    help="stop once test accuracy has stayed above 99%% for this many epochs")
    ap.add_argument("--threads", type=int, default=0, help="torch CPU threads (0 = default)")
    args = ap.parse_args()

    if args.threads:
        torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    os.makedirs(CKPT_DIR, exist_ok=True)
    for f in os.listdir(CKPT_DIR):  # start clean so old runs do not mix in
        if f.startswith("ckpt_") or f == "log.json":
            os.remove(os.path.join(CKPT_DIR, f))

    config = {k: v for k, v in vars(args).items()}
    ckpt_every = args.ckpt_every
    (tr_x, tr_y), (te_x, te_y) = make_dataset(args.p, args.frac, args.seed)
    print(f"p={args.p} train={len(tr_y)} test={len(te_y)} ckpt_every={ckpt_every}")

    model = GrokTransformer(args.p, args.d_model, args.n_heads, args.d_mlp)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd,
                            betas=(0.9, 0.98))

    log = []            # one row per eval, for the loss and accuracy curves
    saved_epochs = []   # which epochs have a checkpoint
    last_ckpt_metrics = None
    above_since = None  # first epoch of the current streak with test acc > 99%
    grok_epoch = None   # first epoch where test acc crossed 99%
    t0 = time.time()

    for epoch in range(args.epochs + 1):
        # Full-batch step. The forward pass at epoch e is evaluated before the
        # update, so the logged metrics describe the weights saved at epoch e.
        logits = model(tr_x)
        loss = F.cross_entropy(logits, tr_y)
        train_loss = loss.item()
        train_acc = (logits.argmax(-1) == tr_y).float().mean().item()

        # Checkpoint epochs are always evaluated, so any grid works.
        do_eval = epoch % args.eval_every == 0 or epoch % ckpt_every == 0
        if do_eval:
            test_loss, test_acc = evaluate(model, te_x, te_y)
            metrics = {"epoch": epoch, "train_loss": train_loss, "train_acc": train_acc,
                       "test_loss": test_loss, "test_acc": test_acc}
            log.append(metrics)

            if test_acc > 0.99:
                if above_since is None:
                    above_since = epoch
                if grok_epoch is None:
                    grok_epoch = epoch
            else:
                above_since = None

            # Save on the regular grid, and also whenever accuracy has moved
            # a lot since the last checkpoint, which makes frames denser
            # around the memorization and grokking transitions.
            moved = last_ckpt_metrics is not None and (
                abs(test_acc - last_ckpt_metrics["test_acc"]) >= 0.05
                or abs(train_acc - last_ckpt_metrics["train_acc"]) >= 0.05)
            stopping = above_since is not None and epoch - above_since >= args.patience
            if epoch % ckpt_every == 0 or moved or stopping or epoch == args.epochs:
                save_checkpoint(model, epoch, config, metrics)
                saved_epochs.append(epoch)
                last_ckpt_metrics = metrics

            if epoch % 100 == 0:
                print(f"epoch {epoch:6d}  train loss {train_loss:.4f} acc {train_acc:.3f}  "
                      f"test loss {test_loss:.4f} acc {test_acc:.3f}  "
                      f"[{time.time() - t0:.0f}s, {len(saved_epochs)} ckpts]", flush=True)

            if stopping:
                print(f"early stop: test accuracy above 99% since epoch {above_since}")
                break

        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()

    elapsed = time.time() - t0
    with open(os.path.join(CKPT_DIR, "log.json"), "w") as f:
        json.dump({"config": config, "log": log, "saved_epochs": saved_epochs,
                   "grok_epoch": grok_epoch, "elapsed_seconds": elapsed}, f)
    print(f"done in {elapsed:.0f}s, {len(saved_epochs)} checkpoints, "
          f"test acc first crossed 99% at epoch {grok_epoch}")


if __name__ == "__main__":
    main()
