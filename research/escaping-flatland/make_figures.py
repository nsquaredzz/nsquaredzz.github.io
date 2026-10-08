"""Every figure in the essay, drawn from results/*.json and from closed-form geometry.

    python make_figures.py            # writes ../../public/blog/escaping-flatland/*.webp
    python make_figures.py --light    # white-background copies in figures-light/ (for the comic blog)
"""
from __future__ import annotations

import argparse
import io
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DARK = dict(bg="#0b0a08", fg="#e9dfc8", dim="#7a7160", rule="#2a2620", amber="#ffb23e", green="#b6f23a", lilac="#a99cff", rust="#d9643a")
LIGHT = dict(bg="#ffffff", fg="#111111", dim="#6b6b6b", rule="#dddddd", amber="#d97706", green="#15803d", lilac="#6d28d9", rust="#dc2626")
C = dict(DARK)
OUT = os.path.join(HERE, "..", "..", "public", "blog", "escaping-flatland")
LABEL = {"euclid": "Euclidean", "euclid_sq": "Euclidean, squared distance", "ball": "Poincare ball", "polydisk": "product of disks"}
NET = {"euclid": "Euclidean GCN", "euclid_modrelu": "Euclidean, phase-keeping activation", "ball": "ball, tangent mean", "polydisk": "disks, gyromidpoint"}


def style():
    plt.rcParams.update({
        "font.family": "monospace", "font.size": 10.5,
        "figure.facecolor": C["bg"], "axes.facecolor": C["bg"], "savefig.facecolor": C["bg"],
        "text.color": C["fg"], "axes.labelcolor": C["fg"], "axes.edgecolor": C["dim"],
        "xtick.color": C["dim"], "ytick.color": C["dim"], "axes.titlecolor": C["fg"], "axes.titlesize": 11,
        "grid.color": C["rule"], "axes.grid": True, "legend.frameon": False, "axes.spines.top": False, "axes.spines.right": False,
    })


def colour(space):
    return {"euclid": C["rust"], "euclid_sq": C["dim"], "euclid_modrelu": C["amber"], "ball": C["lilac"], "polydisk": C["green"]}[space]


def save(fig, name):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)
    im = Image.open(buf).convert("RGB")
    if im.width > 1800:
        im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    im.save(path, "WEBP", quality=88, method=6)
    print(name, im.size, os.path.getsize(path) // 1024, "K")


def load(name):
    with open(os.path.join(HERE, "results", name)) as f:
        return json.load(f)


# ------------------------------------------------------------------ closed-form geometry
def mobius_add(a, z):
    return (a + z) / (1 + np.conj(a) * z)


def dist(u, v):
    return np.arccosh(1 + 2 * abs(u - v) ** 2 / ((1 - abs(u) ** 2) * (1 - abs(v) ** 2)))


def geodesic(p, q, n=40):
    return mobius_add(p, np.linspace(0, 1, n) * mobius_add(-p, q))


def disk(ax):
    t = np.linspace(0, 2 * np.pi, 400)
    ax.plot(np.cos(t), np.sin(t), color=C["dim"], lw=1)
    ax.set_aspect("equal"); ax.set_xlim(-1.06, 1.06); ax.set_ylim(-1.06, 1.06); ax.axis("off")


def build_tree(depth):
    parent, level, frontier = [-1], [0], [0]
    for d in range(1, depth + 1):
        nxt = []
        for u in frontier:
            for _ in range(3 if u == 0 else 2):
                parent.append(u); level.append(d); nxt.append(len(parent) - 1)
        frontier = nxt
    return np.array(parent), np.array(level)


def fig_tree():
    depth, tau = 6, 1.25
    parent, level = build_tree(depth)
    n = len(parent)
    step = np.tanh(tau / 2)
    z = np.zeros(n, dtype=complex)
    kids = [[] for _ in range(n)]
    for i in range(1, n):
        kids[parent[i]].append(i)
    for k, c in enumerate(kids[0]):
        z[c] = step * np.exp(1j * (np.pi / 2 + 2 * np.pi * k / 3))
    for u in range(1, n):
        if not kids[u]:
            continue
        back = np.angle(mobius_add(-z[u], z[parent[u]]))
        for c, off in zip(kids[u], (2 * np.pi / 3, -2 * np.pi / 3)):
            z[c] = mobius_add(z[u], step * np.exp(1j * (back + off)))
    assert np.allclose([dist(z[i], z[parent[i]]) for i in range(1, n)], tau, atol=1e-9)

    lo, hi, e = np.zeros(n), np.zeros(n), np.zeros(n, dtype=complex)
    hi[0] = 2 * np.pi
    for u in range(n):
        if u:
            e[u] = level[u] * np.exp(1j * ((lo[u] + hi[u]) / 2 + np.pi / 2))
        w = (hi[u] - lo[u]) / max(1, len(kids[u]))
        for k, c in enumerate(kids[u]):
            lo[c], hi[c] = lo[u] + k * w, lo[u] + (k + 1) * w
    leaves = np.where(level == depth)[0]
    flat_gap = 2 * np.pi * depth / len(leaves)
    hyp_gap = min(dist(z[a], z[b]) for a in leaves[:8] for b in leaves[:8] if a != b)

    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 5.6))
    colors = plt.get_cmap("YlOrBr_r" if C is DARK or C["bg"] != "#ffffff" else "copper")(np.linspace(0.05, 0.75, depth + 1))
    for i in range(1, n):
        a.plot([e[i].real, e[parent[i]].real], [e[i].imag, e[parent[i]].imag], color=C["dim"], lw=0.6, zorder=1)
    a.scatter(e.real, e.imag, s=np.where(level < 3, 26, 7), c=colors[level], zorder=2, linewidths=0)
    for d in range(1, depth + 1):
        t = np.linspace(0, 2 * np.pi, 200); a.plot(d * np.cos(t), d * np.sin(t), color=C["rule"], lw=0.6, zorder=0)
    a.set_aspect("equal"); a.axis("off")
    a.set_title(f"flat plane: depth d on a circle of radius d\n{len(leaves)} leaves, {flat_gap:.2f} edge lengths apart")
    disk(b)
    for i in range(1, n):
        g = geodesic(z[parent[i]], z[i]); b.plot(g.real, g.imag, color=C["dim"], lw=0.6, zorder=1)
    b.scatter(z.real, z.imag, s=np.where(level < 3, 26, 7), c=colors[level], zorder=2, linewidths=0)
    b.set_title(f"Poincare disk: every edge has hyperbolic length {tau}\nnearest leaves stay {hyp_gap:.2f} apart ({hyp_gap / tau:.1f} edge lengths)")
    save(fig, "tree.webp")


def fig_capacity():
    r = np.linspace(0, 8, 400)
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    ax.plot(r, 2 * np.pi * np.sinh(r), color=C["green"], lw=2, label=r"hyperbolic circle, $2\pi\,\sinh r$")
    ax.plot(r[1:], 2 * np.pi * r[1:], color=C["rust"], lw=2, label=r"flat circle, $2\pi r$")
    d = np.arange(1, 9)
    ax.plot(d, 2.0 ** d, "o", color=C["amber"], ms=5, label=r"nodes at depth $r$ of a binary tree, $2^r$")
    ax.plot(d, 3.0 ** d, "s", color=C["lilac"], ms=4.5, label=r"nodes at depth $r$ of a ternary tree, $3^r$")
    ax.set_yscale("log"); ax.set_xlabel("radius r  (tree depth, one unit per level)"); ax.set_ylabel("circumference  /  node count")
    ax.set_xlim(0, 8); ax.set_ylim(1, 2e4); ax.legend(loc="upper left")
    save(fig, "capacity.webp")


def fig_distance():
    r = np.linspace(0, 0.999, 600)
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.3))
    a.plot(r, 2 * np.arctanh(r), color=C["green"], lw=2, label=r"hyperbolic, $2\,\mathrm{artanh}\,r$")
    a.plot(r, r, color=C["rust"], lw=2, label="Euclidean, r")
    a.set_xlabel("Euclidean radius r = |z|"); a.set_ylabel("distance from the origin"); a.set_xlim(0, 1); a.set_ylim(0, 8); a.legend(loc="upper left")
    a.set_title("distance to the centre")
    for deg, col in ((90, C["amber"]), (30, C["green"]), (5, C["lilac"])):
        u, v = r, r * np.exp(1j * np.deg2rad(deg))
        hyp = np.arccosh(1 + 2 * np.abs(u - v) ** 2 / ((1 - np.abs(u) ** 2) * (1 - np.abs(v) ** 2)))
        b.plot(r, hyp, color=col, lw=2, label=f"hyperbolic, {deg}° apart")
        b.plot(r, np.abs(u - v), color=col, lw=1.2, ls=":", label=f"Euclidean, {deg}° apart")
    b.set_xlabel("common radius r of the two points"); b.set_ylabel("distance between them"); b.set_xlim(0, 1); b.set_ylim(0, 12)
    b.legend(loc="upper left", fontsize=8.5); b.set_title("two points at the same radius")
    save(fig, "distance.webp")


def fig_mobius():
    rng = np.random.default_rng(7)
    m = 600
    u = np.sqrt(rng.uniform(0, 1, m)) * 0.98 * np.exp(1j * rng.uniform(0, 2 * np.pi, m))
    v = np.sqrt(rng.uniform(0, 1, m)) * 0.98 * np.exp(1j * rng.uniform(0, 2 * np.pi, m))
    es, ms = u + v, mobius_add(u, v)
    outside = float(np.mean(np.abs(es) >= 1))
    assert np.all(np.abs(ms) < 1)
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 5.6))
    t = np.linspace(0, 2 * np.pi, 400)
    a.plot(np.cos(t), np.sin(t), color=C["dim"], lw=1)
    a.scatter(es.real, es.imag, s=7, color=C["rust"], linewidths=0, label=f"u + v   ({outside:.0%} land outside the disk)")
    a.scatter(ms.real, ms.imag, s=7, color=C["green"], linewidths=0, label=r"u $\oplus_M$ v   (all inside)")
    a.set_aspect("equal"); a.set_xlim(-2.05, 2.05); a.set_ylim(-2.05, 2.05); a.axis("off")
    a.legend(loc="upper center", bbox_to_anchor=(0.5, 0.02), fontsize=9.5)
    a.set_title(f"{m} random pairs u, v in the disk")
    disk(b)
    shift = 0.55 * np.exp(1j * np.deg2rad(25))
    for rad in np.tanh(np.arange(0.5, 3.01, 0.5) / 2):
        c = rad * np.exp(1j * t)
        b.plot(c.real, c.imag, color=C["rule"], lw=0.8); w = mobius_add(shift, c); b.plot(w.real, w.imag, color=C["amber"], lw=1)
    for ang in np.arange(0, 2 * np.pi, np.pi / 8):
        c = np.linspace(-0.999, 0.999, 300) * np.exp(1j * ang)
        b.plot(c.real, c.imag, color=C["rule"], lw=0.8); w = mobius_add(shift, c); b.plot(w.real, w.imag, color=C["lilac"], lw=1)
    b.plot([0], [0], "o", color=C["dim"], ms=4); b.plot([shift.real], [shift.imag], "o", color=C["green"], ms=5)
    b.set_title(r"a polar grid moved by z $\mapsto$ a $\oplus_M$ z")
    save(fig, "mobius.webp")


# ------------------------------------------------------------------ experiment 1
def fig_e1():
    r = load("e1.json")
    dims = sorted({s["dim"] for s in r["summary"]})
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.4))
    for space in ("euclid_sq", "euclid", "ball", "polydisk"):
        rows = sorted((s for s in r["summary"] if s["space"] == space), key=lambda s: s["dim"])
        x = np.arange(len(dims))
        a.errorbar(x, [s["map_mean"] for s in rows], yerr=[s["map_std"] for s in rows], color=colour(space), lw=2, marker="o", ms=4, capsize=3, label=LABEL[space])
        b.errorbar(x, [s["rank_mean"] for s in rows], yerr=[s["rank_std"] for s in rows], color=colour(space), lw=2, marker="o", ms=4, capsize=3, label=LABEL[space])
    for ax in (a, b):
        ax.set_xticks(np.arange(len(dims))); ax.set_xticklabels(dims); ax.set_xlabel("real dimensions n")
    a.set_ylabel("mean average precision"); a.set_ylim(0, 1.02); a.set_title("higher is better"); a.legend(loc="lower right", fontsize=9)
    b.set_ylabel("mean rank of true relatives"); b.set_yscale("log"); b.set_title("lower is better")
    save(fig, "e1-capacity.webp")


def fig_e1_disk():
    z = np.load(os.path.join(HERE, "results", "e1_embeddings.npz"), allow_pickle=True)
    emb, depth, branch, names = z["disk_long"], z["depth"], z["branch"], z["names"]
    fig, ax = plt.subplots(figsize=(7.2, 7.2))
    disk(ax)
    ids, counts = np.unique(branch[branch >= 0], return_counts=True)
    top = ids[np.argsort(-counts)][:6]
    palette = [C["amber"], C["green"], C["lilac"], C["rust"], "#4fc3f7", "#f48fb1"]
    ax.scatter(emb[:, 0], emb[:, 1], s=5, color=C["dim"], linewidths=0)
    for b_id, col in zip(top, palette):
        m = branch == b_id
        ax.scatter(emb[m, 0], emb[m, 1], s=9, color=col, linewidths=0, label=f"{str(names[b_id]).split('.')[0].replace('_', ' ')} ({int(m.sum())})")
    shallow = np.where(depth <= 1)[0]
    ax.scatter(emb[shallow, 0], emb[shallow, 1], s=26, facecolors="none", edgecolors=C["fg"], linewidths=0.8)
    ax.legend(loc="upper left", bbox_to_anchor=(0.98, 1.0), fontsize=9, markerscale=2)
    save(fig, "e1-disk.webp")


def fig_e1_channels():
    r = load("e1.json")
    ch = sorted(r["channels"], key=lambda c: c["dim"])
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.2), sharey=True)
    x = np.arange(len(ch)); w = 0.36
    for ax, task, title in ((a, "branch", "which branch a synset belongs to"), (b, "depth", "how deep a synset sits")):
        ax.bar(x - w / 2, [c[f"{task}_from_phase"] for c in ch], w, yerr=[c[f"{task}_from_phase_std"] for c in ch], color=C["lilac"], label="from phases only", capsize=3, ecolor=C["dim"])
        ax.bar(x + w / 2, [c[f"{task}_from_magnitude"] for c in ch], w, yerr=[c[f"{task}_from_magnitude_std"] for c in ch], color=C["amber"], label="from magnitudes only", capsize=3, ecolor=C["dim"])
        ax.axhline(ch[0][f"chance_{task}"], color=C["dim"], ls="--", lw=1, label="always guess the largest class")
        ax.set_xticks(x); ax.set_xticklabels([f"{c['dim'] // 2} disk" + ("s" if c["dim"] > 2 else "") for c in ch]); ax.set_title(title); ax.set_ylim(0, 1.02)
    a.set_ylabel("nearest-neighbour accuracy"); b.legend(loc="upper right", fontsize=9)
    save(fig, "e1-channels.webp")


# ------------------------------------------------------------------ experiment 2
def fig_e2a():
    r = load("e2.json")["part_a"]
    graphs = ["mammals", "disease", "cora"]
    titles = {"mammals": "WordNet mammal tree", "disease": "Disease tree", "cora": "Cora citation graph"}
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 4.2), sharey=True)
    L = np.arange(r["layers"] + 1)
    for ax, gname in zip(axes, graphs):
        rows = [c for c in r["curves"] if c["graph"] == gname]
        e = np.array(rows[0]["euclid_dist"])
        ax.plot(L, e / e[0], color=C["rust"], lw=2.2, label="Euclidean mean (any start)")
        for row, col in zip(rows, (C["green"], C["lilac"], C["amber"])):
            p = np.array(row["polydisk_dist"])
            ax.plot(L, p / p[0], color=col, lw=1.6, label=f"gyromidpoint, start at radius {row['radius']:.0f}")
        ax.set_yscale("log"); ax.set_xscale("symlog", linthresh=1); ax.set_xlim(0, r["layers"]); ax.set_xticks([0, 1, 2, 4, 8, 16, 32, 64]); ax.set_xticklabels([0, 1, 2, 4, 8, 16, 32, 64])
        ax.set_title(titles[gname]); ax.set_xlabel("rounds of neighbour averaging")
    axes[0].set_ylabel("mean pairwise distance, relative to the start"); axes[0].legend(loc="lower left", fontsize=8.5)
    save(fig, "e2-operators.webp")


def fig_e2b():
    r = load("e2.json")["part_b"]
    depths = r["depths"]
    x = np.arange(len(depths))
    fig, axes = plt.subplots(2, 2, figsize=(11.5, 7.4), sharex=True, sharey="row")
    for row, graph in enumerate(("cora", "disease")):
        metric = {"accuracy": "test accuracy", "f1": "test F1"}[r["config"][graph]["metric"]]
        for col, alpha in enumerate((0.0, 0.1)):
            ax = axes[row, col]
            for model in ("euclid", "euclid_modrelu", "ball", "polydisk"):
                rows = sorted((t for t in r["table"] if (t["graph"], t["model"], t["alpha"]) == (graph, model, alpha)), key=lambda t: t["depth"])
                ax.errorbar(x, [t["test_mean"] for t in rows], yerr=[t["test_std"] for t in rows], color=colour(model), marker="o", ms=4, lw=1.8, capsize=2.5, label=NET[model])
            name = {"cora": "Cora citation graph", "disease": "Disease tree"}[graph]
            ax.set_title(f"{name}, " + ("plain layers" if alpha == 0 else "with a skip to layer 0"))
            ax.set_ylim(0, 1)
            if col == 0:
                ax.set_ylabel(metric)
            if row == 1:
                ax.set_xticks(x); ax.set_xticklabels(depths); ax.set_xlabel("message-passing layers")
    axes[0, 0].legend(loc="lower left", fontsize=8.5)
    save(fig, "e2-depth.webp")


def fig_e3():
    r = load("e3.json")
    depths = r["depths"]
    fig, ax = plt.subplots(figsize=(8.6, 4.4))
    models = ("euclid", "euclid_modrelu", "ball", "polydisk")
    w = 0.2
    for i, model in enumerate(models):
        rows = sorted((t for t in r["table"] if t["model"] == model), key=lambda t: t["depth"])
        ax.bar(np.arange(len(depths)) + (i - 1.5) * w, [t["test_mean"] for t in rows], w, yerr=[t["test_std"] for t in rows], color=colour(model), label=NET[model], capsize=2.5, ecolor=C["dim"])
    ax.axhline(0.5, color=C["dim"], ls="--", lw=1)
    ax.set_xticks(np.arange(len(depths))); ax.set_xticklabels([f"{d} layer" + ("s" if d > 1 else "") for d in depths])
    ax.set_ylabel("test AUC on held-out links"); ax.set_ylim(0.4, 1.0); ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=2, fontsize=9)
    save(fig, "e3-linkpred.webp")


FIGS = {"tree": fig_tree, "capacity": fig_capacity, "distance": fig_distance, "mobius": fig_mobius, "e1": fig_e1, "e1_disk": fig_e1_disk,
        "e1_channels": fig_e1_channels, "e2a": fig_e2a, "e2b": fig_e2b, "e3": fig_e3}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--light", action="store_true")
    ap.add_argument("--only", nargs="*", default=list(FIGS))
    args = ap.parse_args()
    if args.light:
        C.update(LIGHT)
        OUT = os.path.join(HERE, "figures-light")
    style()
    for name in args.only:
        try:
            FIGS[name]()
        except FileNotFoundError as e:
            print("skipped", name, "-", e)
