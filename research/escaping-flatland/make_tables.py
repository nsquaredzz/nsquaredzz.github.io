"""Print the essay's tables as markdown, straight from results/*.json, so no number is typed by hand.

    python make_tables.py
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NET = {"euclid": "Euclidean GCN", "euclid_modrelu": "Euclidean, phase-keeping activation", "ball": "ball, tangent mean", "polydisk": "disks, gyromidpoint"}
SPACE = {"euclid": "Euclidean", "euclid_sq": "Euclidean, squared distance", "ball": "Poincare ball", "polydisk": "product of disks"}


def load(name):
    path = os.path.join(HERE, "results", name)
    return json.load(open(path)) if os.path.exists(path) else None


def pm(mean, std, digits=3):
    return f"{mean:.{digits}f} ± {std:.{digits}f}"


def e1():
    r = load("e1.json")
    if not r:
        return
    dims = sorted({s["dim"] for s in r["summary"]})
    print(f"\n### E1: reconstruction MAP ({r['dataset']['synsets']} synsets, {r['dataset']['closure_pairs']} pairs, {len(r['protocol']['seeds'])} seeds)\n")
    print("| real dimensions | " + " | ".join(SPACE[s] for s in SPACE) + " |")
    print("|---|" + "---|" * len(SPACE))
    for d in dims:
        row = {s["space"]: s for s in r["summary"] if s["dim"] == d}
        best = max(row[s]["map_mean"] for s in SPACE)
        cells = [("**" if row[s]["map_mean"] >= best - 1e-9 else "") + pm(row[s]["map_mean"], row[s]["map_std"]) + ("**" if row[s]["map_mean"] >= best - 1e-9 else "") for s in SPACE]
        print(f"| {d} | " + " | ".join(cells) + " |")
    print("\n### E1: mean rank\n")
    print("| real dimensions | " + " | ".join(SPACE[s] for s in SPACE) + " |")
    print("|---|" + "---|" * len(SPACE))
    for d in dims:
        row = {s["space"]: s for s in r["summary"] if s["dim"] == d}
        print(f"| {d} | " + " | ".join(pm(row[s]["rank_mean"], row[s]["rank_std"], 2) for s in SPACE) + " |")
    print("\nchosen learning rates:", {f"{s['space']}@{s['dim']}": s["lr"] for s in r["summary"]})
    print("\n### E1: what magnitude and phase carry (product of disks)\n")
    print("| disks | branch from phase | branch from magnitude | depth from phase | depth from magnitude | radius vs depth | radius vs descendants |")
    print("|---|---|---|---|---|---|---|")
    for c in sorted(r["channels"], key=lambda c: c["dim"]):
        print(f"| {c['dim'] // 2} | {pm(c['branch_from_phase'], c['branch_from_phase_std'])} | {pm(c['branch_from_magnitude'], c['branch_from_magnitude_std'])} | "
              f"{pm(c['depth_from_phase'], c['depth_from_phase_std'])} | {pm(c['depth_from_magnitude'], c['depth_from_magnitude_std'])} | "
              f"{c['spearman_depth_radius']:+.2f} | {c['spearman_descendants_radius']:+.2f} |")
    c = r["channels"][0]
    print(f"\nchance: branch {c['chance_branch']:.3f}, depth {c['chance_depth']:.3f}; nodes used {c['nodes_used']}, branches {c['branches']}")
    for c in sorted(r["channels"], key=lambda c: c["dim"]):
        print(f"  n={c['dim']}: median radius {c['median_radius']:.1f}, depth-1 {c['radius_depth1']:.1f}, deepest {c['radius_deepest']:.1f}, internal-only descendants corr {c['spearman_descendants_radius_internal']:+.2f}")
    if "long" in r:
        L = r["long"]
        print(f"\n### E1 long ({L['steps']} steps)\n")
        for t in L["two_dims"]:
            print(f"  n=2 {t['space']}: lr {t['lr']} MAP {pm(t['map_mean'], t['map_std'])} rank {pm(t['rank_mean'], t['rank_std'], 1)} curve {t['map_curve_seed0']}")
        print("  lr grid:", L["lr_grid"])
        for key in ("two_dims_channels", "eight_dims"):
            if key in L:
                c = L[key]
                print(f"  {key}: " + (f"MAP {c['map_mean']:.3f} " if "map_mean" in c else "") + f"branch/phase {c['branch_from_phase']:.3f} branch/mag {c['branch_from_magnitude']:.3f} depth/phase {c['depth_from_phase']:.3f} "
                      f"depth/mag {c['depth_from_magnitude']:.3f} radius~depth {c['spearman_depth_radius']:+.2f} radius~desc {c['spearman_descendants_radius']:+.2f} median radius {c['median_radius']:.1f}")


def e2():
    r = load("e2.json")
    if not r:
        return
    a = r["part_a"]
    print("\n### E2A: share of the starting spread left after k rounds of averaging\n")
    print("| graph | operator | 1 | 2 | 4 | 8 | 16 | 32 | 64 |")
    print("|---|---|---|---|---|---|---|---|---|")
    never_slower = True
    for c in a["curves"]:
        e, p = np.array(c["euclid_dist"]), np.array(c["polydisk_dist"])
        never_slower &= bool(np.all(p[1:] / p[0] <= e[1:] / e[0] + 1e-9))
        if c["radius"] == 1.0:
            print(f"| {c['graph']} | Euclidean mean | " + " | ".join(f"{e[k] / e[0]:.3f}" for k in (1, 2, 4, 8, 16, 32, 64)) + " |")
        print(f"| {c['graph']} | gyromidpoint, start radius {c['radius']:.0f} | " + " | ".join(f"{p[k] / p[0]:.3f}" for k in (1, 2, 4, 8, 16, 32, 64)) + " |")
    print("\ngyromidpoint never contracts more slowly than the mean, at any layer, graph or radius:", never_slower)
    b = r["part_b"]
    for graph in ("cora", "disease"):
        metric = b["config"][graph]["metric"]
        for field, title in (("test", f"test {metric}"), ("mad", "MAD of the last layer")):
            print(f"\n### E2B {graph}: {title}\n")
            print("| network | layers | " + " | ".join(str(d) for d in b["depths"]) + " |")
            print("|---|---|" + "---|" * len(b["depths"]))
            for alpha in (0.0, 0.1):
                for m in NET:
                    rows = sorted((t for t in b["table"] if (t["graph"], t["model"], t["alpha"]) == (graph, m, alpha)), key=lambda t: t["depth"])
                    cells = [pm(t[f"{field}_mean"], t[f"{field}_std"]) if field == "test" else f"{abs(t['mad_mean']):.2f}" for t in rows]
                    print(f"| {NET[m]} | {'plain' if alpha == 0 else 'with skip'} | " + " | ".join(cells) + " |")
    runs = b["runs"]
    print("\ntotal runs", len(runs), "failed", sum(x["failed"] for x in runs))


def e3():
    r = load("e3.json")
    if not r:
        return
    print(f"\n### E3: link prediction AUC ({r['dataset']['nodes']} nodes, {r['dataset']['edges']} edges, {len(r['seeds'])} seeds)\n")
    print("| network | " + " | ".join(f"{d} layer" + ("s" if d > 1 else "") for d in r["depths"]) + " |")
    print("|---|" + "---|" * len(r["depths"]))
    for m in NET:
        rows = sorted((t for t in r["table"] if t["model"] == m), key=lambda t: t["depth"])
        print(f"| {NET[m]} | " + " | ".join(pm(t["test_mean"], t["test_std"]) for t in rows) + " |")
    print("\nfailed", sum(t["failed"] for t in r["table"]), "mean best epoch", {f"{t['model']}@{t['depth']}": round(t["epochs"]) for t in r["table"]})


if __name__ == "__main__":
    e1(); e2(); e3()
