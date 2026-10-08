"""Experiment 2. Does the geometry stop over-smoothing?

Part A, operators alone. Repeat one aggregation step, with no weights and no nonlinearity, and
watch how fast node states become the same. Two operators: the Euclidean mean (which is also what
tangent-space hyperbolic layers compute) and the gyromidpoint on D^H. Start from the same random
tangent vectors at several distances from the origin.

Part B, trained networks. Node classification with 2 to 32 message-passing layers, three models of
equal width, with and without an initial-residual connection. Reports the test metric and the MAD
of the final layer.

    python e2_oversmoothing.py            # writes results/e2.json
    python e2_oversmoothing.py --quick
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
from flatland.data import load_cora, load_disease, mean_adjacency, random_split, wordnet_subtree
from flatland.models import MODELS, mad, mean_pairwise_distance

HERE = os.path.dirname(os.path.abspath(__file__))
HID = 32
CONFIG = {  # fixed in advance, identical for every model
    "cora": dict(lr=0.01, weight_decay=5e-4, dropout=0.5, epochs=400, patience=100, metric="accuracy"),
    "disease": dict(lr=0.01, weight_decay=0.0, dropout=0.2, epochs=400, patience=100, metric="f1"),
}


def get_graph(name: str) -> dict:
    if name == "cora":
        return load_cora()
    if name == "disease":
        return load_disease()
    if name == "mammals":
        t = wordnet_subtree("mammal.n.01")
        return {"name": "mammals", "n": len(t["names"]), "edges": np.unique(np.sort(t["direct"], axis=1), axis=0)}
    raise KeyError(name)


# ------------------------------------------------------------------ part A
def operator_run(job: dict) -> dict:
    torch.set_num_threads(1)
    g = get_graph(job["graph"])
    P = mean_adjacency(g["n"], g["edges"]).double()
    gen = torch.Generator().manual_seed(job["seed"])
    h = HID // 2
    v = torch.randn(g["n"], h, 2, generator=gen, dtype=torch.float64)
    v = v / v.flatten(1).norm(dim=1)[:, None, None] * (job["radius"] / 2)      # product-metric radius = job["radius"]
    flat = v.flatten(1).clone()                                                # Euclidean / tangent-space mean
    z = G.ball_exp0(v)                                                         # gyromidpoint on D^H
    out = {"euclid": {"mad": [], "dist": []}, "polydisk": {"mad": [], "dist": []}}
    for layer in range(job["layers"] + 1):
        if layer:
            flat = torch.sparse.mm(P, flat)
            z = G.sparse_gyromidpoint(P, z)
        out["euclid"]["mad"].append(mad(flat))
        out["euclid"]["dist"].append(mean_pairwise_distance("euclid", flat, sample=400))
        out["polydisk"]["mad"].append(mad(G.ball_log0(z).flatten(1)))
        out["polydisk"]["dist"].append(mean_pairwise_distance("polydisk", z, sample=400))
    return dict(graph=job["graph"], radius=job["radius"], seed=job["seed"], curves=out)


# ------------------------------------------------------------------ part B
def binary_f1(pred: torch.Tensor, y: torch.Tensor) -> float:
    """F1 of the positive class, the metric Chami et al. (2019) report for the two-class Disease graph."""
    tp = float(((pred == 1) & (y == 1)).sum())
    fp = float(((pred == 1) & (y != 1)).sum())
    fn = float(((pred != 1) & (y == 1)).sum())
    return 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0


def train_run(job: dict) -> dict:
    torch.set_num_threads(1)
    torch.manual_seed(job["seed"])
    g = get_graph(job["graph"])
    cfg = CONFIG[job["graph"]]
    split = g["split"] or random_split(g["n"], g["y"], job["seed"])
    x, y = torch.as_tensor(g["x"]), torch.as_tensor(g["y"])
    P = mean_adjacency(g["n"], g["edges"])
    n_class = int(y.max()) + 1
    model = MODELS[job["model"]](x.shape[1], HID, n_class, job["depth"], alpha=job["alpha"], dropout=cfg["dropout"]).reset()
    opt = torch.optim.Adam(model.parameters(), lr=cfg["lr"], weight_decay=cfg["weight_decay"])
    idx = {k: torch.as_tensor(v) for k, v in split.items()}

    def score(logits, which):
        pred = logits[idx[which]].argmax(1)
        if cfg["metric"] == "accuracy":
            return float((pred == y[idx[which]]).float().mean())
        return binary_f1(pred, y[idx[which]])

    best, best_state, bad, t0, failed = (-1.0, 0.0, 0), None, 0, time.time(), False
    for epoch in range(1, cfg["epochs"] + 1):
        model.train()
        loss = F.cross_entropy(model(x, P)[idx["train"]], y[idx["train"]])
        if not torch.isfinite(loss):
            failed = True
            break
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        model.eval()
        with torch.no_grad():
            logits = model(x, P)
        val = score(logits, "val")
        if val > best[0]:
            best, best_state, bad = (val, score(logits, "test"), epoch), copy.deepcopy(model.state_dict()), 0
        else:
            bad += 1
            if bad >= cfg["patience"]:
                break
    out = dict(graph=job["graph"], model=job["model"], depth=job["depth"], alpha=job["alpha"], seed=job["seed"],
               val=best[0], test=best[1], best_epoch=best[2], epochs=epoch, failed=failed, seconds=time.time() - t0)
    if best_state is not None:
        model.load_state_dict(best_state)
        model.eval()
        with torch.no_grad():
            states = model.embed(x, P)
        out["mad_final"] = mad(model.tangent(states[-1]))
        out["mad_input"] = mad(model.tangent(states[0]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--part", choices=["a", "b", "both"], default="both")
    args = ap.parse_args()
    out_path = os.path.join(HERE, "results", "e2.json")
    result = json.load(open(out_path)) if os.path.exists(out_path) and not args.quick else {}

    for name in ("cora", "disease", "mammals"):                # download once, before forking
        g = get_graph(name)
        print(f"{name}: {g['n']} nodes, {len(g['edges'])} edges")

    with Pool(args.workers) as pool:
        if args.part in ("a", "both"):
            layers = 8 if args.quick else 64
            jobs = [dict(graph=gr, radius=r, seed=s, layers=layers) for gr in ("mammals", "disease", "cora")
                    for r in (1.0, 4.0, 8.0) for s in range(2 if args.quick else 10)]
            runs = pool.map(operator_run, jobs)
            part_a = []
            for gr in ("mammals", "disease", "cora"):
                for r in (1.0, 4.0, 8.0):
                    rs = [x for x in runs if x["graph"] == gr and x["radius"] == r]
                    entry = dict(graph=gr, radius=r)
                    for op in ("euclid", "polydisk"):
                        for k in ("mad", "dist"):
                            arr = np.array([x["curves"][op][k] for x in rs])
                            entry[f"{op}_{k}"] = arr.mean(0).tolist()
                    part_a.append(entry)
                    e, p = np.array(entry["euclid_dist"]), np.array(entry["polydisk_dist"])
                    show = [1, 2, 4, 8] + ([] if args.quick else [16, 32, 64])
                    print(f"A {gr:8s} r0={r:3.0f}  spread kept, euclid:   " + " ".join(f"L{l}={e[l] / e[0]:.3f}" for l in show))
                    print(f"  {'':8s} {'':7s} spread kept, polydisk: " + " ".join(f"L{l}={p[l] / p[0]:.3f}" for l in show))
            result["part_a"] = dict(layers=layers, hid=HID, seeds=2 if args.quick else 10, curves=part_a)

        if args.part in ("b", "both"):
            depths = [2, 8] if args.quick else [2, 4, 8, 16, 32]
            seeds = [0] if args.quick else [0, 1, 2, 3, 4]
            jobs = [dict(graph=gr, model=m, depth=d, alpha=a, seed=s) for gr in ("cora", "disease") for m in MODELS
                    for a in (0.0, 0.1) for d in depths for s in seeds]
            jobs.sort(key=lambda j: -j["depth"])               # long jobs first
            runs, t0 = [], time.time()
            for r in pool.imap_unordered(train_run, jobs, chunksize=1):
                runs.append(r)
                if len(runs) % 20 == 0 or len(runs) == len(jobs):
                    print(f"  trained {len(runs)}/{len(jobs)} runs, {time.time() - t0:.0f} s", flush=True)
            table = []
            for gr in ("cora", "disease"):
                for m in MODELS:
                    for a in (0.0, 0.1):
                        for d in depths:
                            rs = [r for r in runs if (r["graph"], r["model"], r["alpha"], r["depth"]) == (gr, m, a, d)]
                            te = np.array([r["test"] for r in rs])
                            md = np.array([r.get("mad_final", np.nan) for r in rs])
                            table.append(dict(graph=gr, model=m, alpha=a, depth=d, test_mean=te.mean(), test_std=te.std(), mad_mean=float(np.nanmean(md)),
                                              mad_std=float(np.nanstd(md)), mad_input=float(np.nanmean([r.get("mad_input", np.nan) for r in rs])),
                                              failed=int(sum(r["failed"] for r in rs)), seconds=float(np.mean([r["seconds"] for r in rs]))))
                            print(f"B {gr:8s} {m:9s} alpha={a} L={d:2d}  {CONFIG[gr]['metric']} {te.mean():.3f} ± {te.std():.3f}   MAD {np.nanmean(md):.3f}   failed {table[-1]['failed']}")
            result["part_b"] = dict(config=CONFIG, hid=HID, depths=depths, seeds=seeds, table=table, runs=runs)

    if not args.quick:
        with open(out_path, "w") as f:
            json.dump(result, f, indent=1)
        print("wrote results/e2.json")


if __name__ == "__main__":
    main()
