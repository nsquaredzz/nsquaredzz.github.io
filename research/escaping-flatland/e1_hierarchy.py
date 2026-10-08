"""Experiment 1. How much hierarchy fits in n dimensions?

Reconstruction of the WordNet mammal hypernymy closure, the protocol of Nickel & Kiela (2017):
embed every synset, then for each synset rank all others by distance and score how highly its
true ancestors and descendants rank. Trained with the essay's Equation 4 (a softmax over sampled
negatives with similarity -d / tau), which for tau = 1 is the Nickel & Kiela loss.

Spaces at equal real dimension n: Euclidean (distance and squared distance), the Poincare ball
B^n, and the product of n/2 Poincare disks D^(n/2), the essay's manifold.

    python e1_hierarchy.py            # full run, writes results/e1.json and results/e1_embeddings.npz
    python e1_hierarchy.py --quick    # a smoke test
"""
from __future__ import annotations

import argparse
import json
import os
import time
from multiprocessing import Pool

import numpy as np
import torch

from flatland import geom as G
from flatland.data import wordnet_subtree

HERE = os.path.dirname(os.path.abspath(__file__))
SPACES = ["euclid", "euclid_sq", "ball", "polydisk"]


def evaluate(D: torch.Tensor, adj: torch.Tensor) -> tuple[float, float]:
    """Mean rank of true neighbours among non-neighbours, and mean average precision."""
    n = D.shape[0]
    D = D.clone()
    D.fill_diagonal_(float("inf"))
    order = D.argsort(dim=1)[:, : n - 1]                       # everyone but the node itself
    hits = adj.gather(1, order).double()                        # 1 where the k-th closest is a true neighbour
    npos = hits.sum(1)
    prec = hits.cumsum(1) / torch.arange(1, n, dtype=torch.float64)
    ap = (prec * hits).sum(1) / npos.clamp_min(1)
    pos_rank = torch.arange(1, n, dtype=torch.float64)[None] - (hits.cumsum(1) - 1)   # rank among negatives only
    mean_rank = (pos_rank * hits).sum() / hits.sum()
    keep = npos > 0
    return float(mean_rank), float(ap[keep].mean())


def train(job: dict) -> dict:
    torch.set_num_threads(1)
    torch.set_default_dtype(torch.float64)
    data = job["data"]
    n_nodes, dim, S = data["n"], job["dim"], G.SPACES[job["space"]]
    g = torch.Generator().manual_seed(job["seed"])
    adj = torch.zeros(n_nodes, n_nodes, dtype=torch.bool)
    pairs = torch.as_tensor(data["closure"])
    adj[pairs[:, 0], pairs[:, 1]] = True
    adj = adj | adj.T
    u, v = adj.nonzero(as_tuple=True)                           # every related pair, both directions

    theta = ((torch.rand(n_nodes, dim, generator=g) * 2 - 1) * 1e-3).requires_grad_()
    opt = torch.optim.Adam([theta], lr=job["lr"])
    curve = {}
    t0 = time.time()
    for step in range(1, job["steps"] + 1):
        sel = torch.randint(len(u), (job["batch"],), generator=g)   # a mini-batch of related pairs
        bu, bv = u[sel], v[sel]
        neg = torch.randint(n_nodes, (len(bu), job["negatives"]), generator=g)
        x = S.exp0(theta)
        cand = torch.cat([bv[:, None], neg], dim=1)
        d = S.dist(x[bu][:, None, :], x[cand])
        logits = -d / job["tau"]
        bad = adj[bu[:, None], neg] | (neg == bu[:, None])      # sampled "negatives" that are not negatives
        logits = torch.cat([logits[:, :1], logits[:, 1:].masked_fill(bad, float("-inf"))], dim=1)
        loss = torch.nn.functional.cross_entropy(logits, torch.zeros(len(bu), dtype=torch.long))
        opt.zero_grad()
        loss.backward()
        opt.step()
        if step in job["checkpoints"] or step == job["steps"]:
            with torch.no_grad():
                x = S.exp0(theta)
                D = S.dist(x[:, None, :], x[None, :, :])
                curve[step] = (*evaluate(D, adj), float(loss))
    rank, mapv, final_loss = curve[job["steps"]]
    out = {k: job[k] for k in ("space", "dim", "seed", "lr")}
    out.update(mean_rank=rank, map=mapv, loss=final_loss, curve=curve, seconds=time.time() - t0)
    if job.get("keep"):
        with torch.no_grad():
            out["embedding"] = S.exp0(theta).numpy()
    return out


def collect(pool, jobs, label):
    """Run jobs longest first and report progress as they finish."""
    jobs = sorted(jobs, key=lambda j: -j["dim"])
    out, t0 = [], time.time()
    for r in pool.imap_unordered(train, jobs, chunksize=1):
        out.append(r)
        if len(out) % 10 == 0 or len(out) == len(jobs):
            print(f"  {label}: {len(out)}/{len(jobs)} runs, {time.time() - t0:.0f} s", flush=True)
    return out


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    from scipy.stats import spearmanr

    return float(spearmanr(a, b).statistic)


def loo_1nn(dist: np.ndarray, labels: np.ndarray) -> float:
    """Leave-one-out nearest-neighbour accuracy from a distance matrix."""
    d = dist.copy()
    np.fill_diagonal(d, np.inf)
    return float((labels[d.argmin(1)] == labels).mean())


def channel_analysis(emb: np.ndarray, depth: np.ndarray, branch: np.ndarray, descendants: np.ndarray, root: int) -> dict:
    """Does magnitude carry generality and phase carry branch, as Equation 1 says?

    For a polydisk embedding: nearest-neighbour prediction of a node's branch and of its depth,
    once from the phases alone and once from the magnitudes alone; and rank correlations between
    a node's hyperbolic distance from the root and (a) its depth, (b) how many descendants it has.
    Distances are measured from the root, which removes the freedom to translate the whole embedding.
    """
    z = torch.as_tensor(emb)
    pairs = G.PolyDisk.pairs(z)
    centred = G.ball_mobius_add(-pairs[root][None].expand_as(pairs), pairs)         # every disk re-centred at the root
    mag = centred.norm(dim=-1).numpy()
    phase = torch.atan2(centred[..., 1], centred[..., 0]).numpy()
    radius = 2 * np.arctanh(np.clip(mag, 0, 1 - 1e-15))        # hyperbolic radius in each disk
    total_radius = np.sqrt((radius ** 2).sum(1))
    sizes = {b: int((branch == b).sum()) for b in np.unique(branch) if b >= 0}
    big = [b for b, c in sizes.items() if c >= 20]
    keep = np.isin(branch, big)
    dphi = phase[keep][:, None, :] - phase[keep][None, :, :]
    d_phase = (1 - np.cos(dphi)).sum(-1)
    d_mag = np.abs(radius[keep][:, None, :] - radius[keep][None, :, :]).sum(-1)
    lab_b, lab_d = branch[keep], depth[keep]
    others = np.arange(len(depth)) != root
    inner = others & (descendants > 0)
    return {
        "nodes_used": int(keep.sum()),
        "branches": len(big),
        "chance_branch": float(max(np.mean(lab_b == b) for b in big)),
        "chance_depth": float(max(np.mean(lab_d == d) for d in np.unique(lab_d))),
        "branch_from_phase": loo_1nn(d_phase, lab_b),
        "branch_from_magnitude": loo_1nn(d_mag, lab_b),
        "depth_from_phase": loo_1nn(d_phase, lab_d),
        "depth_from_magnitude": loo_1nn(d_mag, lab_d),
        "spearman_depth_radius": spearman(depth[others], total_radius[others]),
        "spearman_descendants_radius": spearman(descendants[others], total_radius[others]),
        "spearman_descendants_radius_internal": spearman(descendants[inner], total_radius[inner]),
        "median_radius": float(np.median(total_radius[others])),
        "radius_depth1": float(total_radius[depth == 1].mean()),
        "radius_deepest": float(total_radius[depth == depth.max()].mean()),
    }


def average(dicts: list[dict]) -> dict:
    out = {k: float(np.mean([d[k] for d in dicts])) for k in dicts[0]}
    out.update({k + "_std": float(np.std([d[k] for d in dicts])) for k in dicts[0] if k not in ("nodes_used", "branches")})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    tree = wordnet_subtree("mammal.n.01")
    data = {"n": len(tree["names"]), "closure": tree["closure"]}
    descendants = np.bincount(tree["closure"][:, 1], minlength=data["n"])
    dims = [2, 4] if args.quick else [2, 4, 8, 16, 32]
    seeds = [0] if args.quick else [0, 1, 2, 3, 4]
    lrs = [0.03] if args.quick else [0.003, 0.01, 0.03, 0.1, 0.3]
    steps = 300 if args.quick else 4000
    base = dict(data=data, steps=steps, batch=2048, negatives=10, tau=1.0, checkpoints=[steps // 6, steps // 3, 2 * steps // 3])
    print(f"mammals: {data['n']} synsets, {len(tree['closure'])} closure pairs, {len(tree['direct'])} direct edges, max depth {tree['depth'].max()}")

    with Pool(args.workers) as pool:
        # 1. learning rate per (space, dimension), chosen on seed 0 by the reconstruction MAP itself
        grid = [dict(base, space=s, dim=d, seed=0, lr=lr) for s in SPACES for d in dims for lr in lrs]
        tuned = collect(pool, grid, "tuning")
        best = {}
        for r in tuned:
            k = (r["space"], r["dim"])
            if k not in best or r["map"] > best[k]["map"]:
                best[k] = r
        # 2. five seeds at the chosen rate
        jobs = [dict(base, space=s, dim=d, seed=seed, lr=best[(s, d)]["lr"], keep=(s == "polydisk"))
                for s in SPACES for d in dims for seed in seeds]
        runs = collect(pool, jobs, "seeds")

        # 3. two checks at four times the training budget
        long_steps = steps * 4
        long_base = dict(base, steps=long_steps, checkpoints=[long_steps // 4, long_steps // 2, 3 * long_steps // 4])
        #    (a) two dimensions, where the main budget had not converged: one disk against the flat plane
        long_grid = [dict(long_base, space=s, dim=2, seed=0, lr=lr) for s in ("euclid", "ball") for lr in ([0.1] if args.quick else lrs)]
        long_tuned = collect(pool, long_grid, "long tuning")
        long_best = {}
        for r in long_tuned:
            if r["space"] not in long_best or r["map"] > long_best[r["space"]]["map"]:
                long_best[r["space"]] = r
        long_jobs = [dict(long_base, space=s, dim=2, seed=seed, lr=long_best[s]["lr"], keep=(s == "ball")) for s in ("euclid", "ball") for seed in seeds]
        #    (b) eight dimensions on the disks: does the radial structure change if training goes on?
        long_jobs += [dict(long_base, space="polydisk", dim=dims[-1] if args.quick else 8, seed=seed, lr=best[("polydisk", dims[-1] if args.quick else 8)]["lr"], keep=True) for seed in seeds]
        long_runs = collect(pool, long_jobs, "long runs")

    summary, embeddings, channels = [], {}, []
    for s in SPACES:
        for d in dims:
            rs = [r for r in runs if r["space"] == s and r["dim"] == d]
            maps, ranks = np.array([r["map"] for r in rs]), np.array([r["mean_rank"] for r in rs])
            last, prev = rs[0]["curve"][steps], rs[0]["curve"][2 * steps // 3]
            summary.append(dict(space=s, dim=d, lr=rs[0]["lr"], map_mean=maps.mean(), map_std=maps.std(), rank_mean=ranks.mean(), rank_std=ranks.std(),
                                map_at_two_thirds=prev[1], map_final_seed0=last[1], lr_grid={str(t["lr"]): t["map"] for t in tuned if t["space"] == s and t["dim"] == d}))
            print(f"{s:10s} n={d:2d} lr={rs[0]['lr']:<5} MAP {maps.mean():.3f} ± {maps.std():.3f}   mean rank {ranks.mean():7.2f} ± {ranks.std():.2f}   (seed 0: {prev[1]:.3f} at 2/3 of training)")
            if s == "polydisk":
                channels.append(dict(dim=d, **average([channel_analysis(r["embedding"], tree["depth"], tree["branch"], descendants, tree["root"]) for r in rs])))
                embeddings[f"polydisk_{d}"] = sorted(rs, key=lambda r: r["seed"])[0]["embedding"]

    def show(c, label):
        print(f"{label}: branch from phase {c['branch_from_phase']:.3f}, from magnitude {c['branch_from_magnitude']:.3f} (chance {c['chance_branch']:.3f}) | "
              f"depth from phase {c['depth_from_phase']:.3f}, from magnitude {c['depth_from_magnitude']:.3f} (chance {c['chance_depth']:.3f}) | "
              f"spearman radius~depth {c['spearman_depth_radius']:+.3f}, radius~descendants {c['spearman_descendants_radius']:+.3f} "
              f"(internal nodes {c['spearman_descendants_radius_internal']:+.3f}) | radius depth 1 {c['radius_depth1']:.1f}, deepest {c['radius_deepest']:.1f}")

    for c in channels:
        show(c, f"polydisk n={c['dim']:2d}")

    long = {"steps": long_steps, "two_dims": [], "lr_grid": {r["space"] + "@" + str(r["lr"]): r["map"] for r in long_tuned}}
    for s in ("euclid", "ball"):
        rs = [r for r in long_runs if r["space"] == s and r["dim"] == 2]
        maps, ranks = np.array([r["map"] for r in rs]), np.array([r["mean_rank"] for r in rs])
        c0 = sorted(rs, key=lambda r: r["seed"])[0]["curve"]
        long["two_dims"].append(dict(space=s, lr=rs[0]["lr"], map_mean=maps.mean(), map_std=maps.std(), rank_mean=ranks.mean(), rank_std=ranks.std(),
                                     map_curve_seed0={str(k): v[1] for k, v in sorted(c0.items())}))
        print(f"long, n=2, {s:7s} lr={rs[0]['lr']:<5} MAP {maps.mean():.3f} ± {maps.std():.3f}   mean rank {ranks.mean():7.2f} ± {ranks.std():.2f}   curve {[round(v[1], 3) for _, v in sorted(c0.items())]}")
        if s == "ball":
            long["two_dims_channels"] = average([channel_analysis(r["embedding"], tree["depth"], tree["branch"], descendants, tree["root"]) for r in rs])
            show(long["two_dims_channels"], "long, one disk")
            embeddings["disk_long"] = sorted(rs, key=lambda r: r["seed"])[0]["embedding"]
    rs = [r for r in long_runs if r["space"] == "polydisk"]
    if rs:
        long["eight_dims"] = dict(map_mean=float(np.mean([r["map"] for r in rs])), **average([channel_analysis(r["embedding"], tree["depth"], tree["branch"], descendants, tree["root"]) for r in rs]))
        show(long["eight_dims"], f"long, polydisk n= 8 (MAP {long['eight_dims']['map_mean']:.3f})")

    out = dict(dataset=dict(root="mammal.n.01", synsets=data["n"], closure_pairs=int(len(tree["closure"])), direct_edges=int(len(tree["direct"])), max_depth=int(tree["depth"].max())),
               protocol=dict(steps=steps, batch=2048, negatives=10, tau=1.0, optimiser="Adam on tangent coordinates at the origin", lr_grid=lrs, seeds=seeds),
               summary=summary, channels=channels, long=long)
    if not args.quick:
        os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
        with open(os.path.join(HERE, "results", "e1.json"), "w") as f:
            json.dump(out, f, indent=1)
        np.savez_compressed(os.path.join(HERE, "results", "e1_embeddings.npz"), depth=tree["depth"], branch=tree["branch"], names=np.array(tree["names"]),
                            descendants=descendants, root=tree["root"], **embeddings)
        print("wrote results/e1.json and results/e1_embeddings.npz")


if __name__ == "__main__":
    main()
