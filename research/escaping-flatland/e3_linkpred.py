"""Experiment 3. The whole pipeline at once.

Link prediction on the Disease tree (Chami et al. 2019): 2,665 nodes with 11 real features. Features
go through the lift (Equation 1), L message-passing layers (Equation 4) over the training edges, and
the model is trained with the contrastive loss on distance (Equation 5). Held-out edges are scored by
negative distance. Same loss, same width, same optimiser for every space; only the space changes.

    python e3_linkpred.py            # writes results/e3.json
    python e3_linkpred.py --quick
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import time
from multiprocessing import Pool

import numpy as np
import torch
import torch.nn.functional as F

from flatland import geom as G
from flatland.data import edge_split, load_disease_lp, mean_adjacency
from flatland.models import MODELS

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = dict(hid=16, lr=0.01, weight_decay=0.0, dropout=0.0, epochs=6000, patience=400, negatives=10, tau=1.0, eval_every=5)


def distance(space: str, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    if space == "euclid":
        return G.Euclid.dist(a, b)
    if space == "ball":
        return G.ball_dist(a, b)
    return (G.ball_dist(a, b).pow(2).sum(-1) + 1e-9).sqrt()              # product of disks: states are (..., H, 2)


def auc(pos: torch.Tensor, neg: torch.Tensor) -> float:
    """Area under the ROC curve from scores (higher = more likely an edge), by the rank-sum formula."""
    from scipy.stats import rankdata

    ranks = rankdata(torch.cat([pos, neg]).numpy())
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def run(job: dict) -> dict:
    torch.set_num_threads(1)
    torch.manual_seed(job["seed"])
    g = load_disease_lp()
    split = edge_split(g["n"], g["edges"], job["seed"])
    x = torch.as_tensor(g["x"])
    P = mean_adjacency(g["n"], split["train"])
    model = MODELS[job["model"]](x.shape[1], CONFIG["hid"], 1, job["depth"], alpha=0.0, dropout=CONFIG["dropout"]).reset()
    params = [p for n, p in model.named_parameters() if not n.startswith("out.")]
    opt = torch.optim.Adam(params, lr=CONFIG["lr"], weight_decay=CONFIG["weight_decay"])
    tr = torch.as_tensor(split["train"])
    u = torch.cat([tr[:, 0], tr[:, 1]])
    v = torch.cat([tr[:, 1], tr[:, 0]])
    adj = torch.zeros(g["n"], g["n"], dtype=torch.bool)
    adj[u, v] = True
    gen = torch.Generator().manual_seed(job["seed"])
    ev = {k: torch.as_tensor(split[k]) for k in ("val_pos", "val_neg", "test_pos", "test_neg")}

    def score(z, pairs):
        return -distance(model.space, z[pairs[:, 0]], z[pairs[:, 1]])

    best, bad, t0, failed = (-1.0, 0.0, 0), 0, time.time(), False
    max_epochs = 100 if job.get("quick") else job.get("epochs", CONFIG["epochs"])
    patience = job.get("patience", CONFIG["patience"])
    for epoch in range(1, max_epochs + 1):
        model.train()
        z = model.embed(x, P)[-1]
        neg = torch.randint(g["n"], (len(u), CONFIG["negatives"]), generator=gen)
        cand = torch.cat([v[:, None], neg], dim=1)
        d = distance(model.space, z[u][:, None], z[cand])
        logits = -d / CONFIG["tau"]
        badneg = adj[u[:, None], neg] | (neg == u[:, None])
        logits = torch.cat([logits[:, :1], logits[:, 1:].masked_fill(badneg, float("-inf"))], dim=1)
        loss = F.cross_entropy(logits, torch.zeros(len(u), dtype=torch.long))
        if not torch.isfinite(loss):
            failed = True
            break
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 5.0)
        opt.step()
        if epoch % CONFIG["eval_every"] == 0:
            model.eval()
            with torch.no_grad():
                z = model.embed(x, P)[-1]
                val = auc(score(z, ev["val_pos"]), score(z, ev["val_neg"]))
                if val > best[0]:
                    best, bad = (val, auc(score(z, ev["test_pos"]), score(z, ev["test_neg"])), epoch), 0
                else:
                    bad += CONFIG["eval_every"]
                    if bad >= patience:
                        break
    return dict(model=job["model"], depth=job["depth"], seed=job["seed"], val=best[0], test=best[1], best_epoch=best[2], epochs=epoch,
                failed=failed, seconds=time.time() - t0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--workers", type=int, default=9)
    args = ap.parse_args()
    g = load_disease_lp()
    print(f"disease_lp: {g['n']} nodes, {len(g['edges'])} edges, {g['x'].shape[1]} features")
    depths = [2] if args.quick else [1, 2, 4]
    seeds = [0] if args.quick else [0, 1, 2, 3, 4]
    jobs = [dict(model=m, depth=d, seed=s, quick=args.quick) for m in MODELS for d in depths for s in seeds]
    # the flat one-layer network trains slowly; give it room to stop by itself, so the comparison is not cut short
    extra = [] if args.quick else [dict(model="euclid", depth=1, seed=s, epochs=30000, patience=2000) for s in seeds]
    with Pool(args.workers) as pool:
        runs = pool.map(run, jobs, chunksize=1)
        long_runs = pool.map(run, extra, chunksize=1)
    table = []
    for m in MODELS:
        for d in depths:
            rs = [r for r in runs if r["model"] == m and r["depth"] == d]
            t = np.array([r["test"] for r in rs])
            table.append(dict(model=m, depth=d, test_mean=t.mean(), test_std=t.std(), val_mean=float(np.mean([r["val"] for r in rs])),
                              failed=int(sum(r["failed"] for r in rs)), epochs=float(np.mean([r["best_epoch"] for r in rs]))))
            print(f"{m:15s} L={d}  test AUC {t.mean():.3f} ± {t.std():.3f}   val {table[-1]['val_mean']:.3f}   best epoch {table[-1]['epochs']:.0f}   failed {table[-1]['failed']}")
    long = None
    if long_runs:
        t = np.array([r["test"] for r in long_runs])
        long = dict(model="euclid", depth=1, epochs=30000, patience=2000, test_mean=t.mean(), test_std=t.std(), best_epoch=float(np.mean([r["best_epoch"] for r in long_runs])),
                    stopped_early=int(sum(r["epochs"] < 30000 for r in long_runs)))
        print(f"flat, 1 layer, up to 30000 epochs: test AUC {t.mean():.3f} ± {t.std():.3f}, best epoch {long['best_epoch']:.0f}, stopped by itself in {long['stopped_early']} of {len(long_runs)} runs")
    if not args.quick:
        with open(os.path.join(HERE, "results", "e3.json"), "w") as f:
            json.dump(dict(long_flat_one_layer=long, dataset=dict(nodes=g["n"], edges=int(len(g["edges"])), features=int(g["x"].shape[1])), config=CONFIG, depths=depths, seeds=seeds, table=table, runs=runs), f, indent=1)
        print("wrote results/e3.json")


if __name__ == "__main__":
    main()
