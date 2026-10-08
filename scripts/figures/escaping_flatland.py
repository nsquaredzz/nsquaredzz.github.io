"""Figures for posts/escaping-flatland.md. Everything is computed, nothing is drawn by hand.

    python3 scripts/figures/escaping_flatland.py

Needs numpy, matplotlib and pillow. Writes webp files to public/blog/escaping-flatland/.
"""
import io
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "blog", "escaping-flatland")
BG, BONE, DIM, AMBER, GREEN, LILAC, RUST, RULE = "#0b0a08", "#e9dfc8", "#7a7160", "#ffb23e", "#b6f23a", "#a99cff", "#d9643a", "#2a2620"

plt.rcParams.update({
    "font.family": "monospace", "font.size": 10.5,
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "text.color": BONE, "axes.labelcolor": BONE, "axes.edgecolor": DIM,
    "xtick.color": DIM, "ytick.color": DIM, "axes.titlecolor": BONE, "axes.titlesize": 11,
    "grid.color": RULE, "axes.grid": True, "legend.frameon": False, "axes.spines.top": False, "axes.spines.right": False,
})


def save(fig, name):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)
    im = Image.open(buf).convert("RGB")
    if im.width > 1800:
        im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, "WEBP", quality=88, method=6)
    print(name, im.size, os.path.getsize(path) // 1024, "K")


# ---- hyperbolic helpers on the Poincare disk (complex numbers)
def mobius_add(a, z):
    """a (+) z = (a + z) / (1 + conj(a) z). Maps the disk to itself and sends 0 to a."""
    return (a + z) / (1 + np.conj(a) * z)


def dist(u, v):
    return np.arccosh(1 + 2 * abs(u - v) ** 2 / ((1 - abs(u) ** 2) * (1 - abs(v) ** 2)))


def geodesic(p, q, n=40):
    """Points on the geodesic from p to q: a straight segment in the frame where p is the origin."""
    w = mobius_add(-p, q)
    return mobius_add(p, np.linspace(0, 1, n) * w)


def disk(ax):
    t = np.linspace(0, 2 * np.pi, 400)
    ax.plot(np.cos(t), np.sin(t), color=DIM, lw=1)
    ax.set_aspect("equal"); ax.set_xlim(-1.06, 1.06); ax.set_ylim(-1.06, 1.06)
    ax.axis("off")


# ---- the tree used in figures 1 and 5: root with 3 children, every other node with 2
def build_tree(depth):
    parent, level = [-1], [0]
    frontier = [0]
    for d in range(1, depth + 1):
        nxt = []
        for u in frontier:
            for _ in range(3 if u == 0 else 2):
                parent.append(u); level.append(d); nxt.append(len(parent) - 1)
        frontier = nxt
    return np.array(parent), np.array(level)


def fig_tree():
    depth, tau = 6, 1.25                      # tau: hyperbolic length of every edge
    parent, level = build_tree(depth)
    n = len(parent)
    step = np.tanh(tau / 2)                   # Euclidean radius of a hyperbolic step from the origin

    # hyperbolic layout: each node sits at hyperbolic distance tau from its parent, edges meet at 120 degrees
    z = np.zeros(n, dtype=complex)
    kids = [[] for _ in range(n)]
    for i in range(1, n):
        kids[parent[i]].append(i)
    for k, c in enumerate(kids[0]):
        z[c] = step * np.exp(1j * (np.pi / 2 + 2 * np.pi * k / 3))
    for u in range(1, n):
        if not kids[u]:
            continue
        back = np.angle(mobius_add(-z[u], z[parent[u]]))      # direction of the parent seen from u
        for c, off in zip(kids[u], (2 * np.pi / 3, -2 * np.pi / 3)):
            z[c] = mobius_add(z[u], step * np.exp(1j * (back + off)))
    edge = np.array([dist(z[i], z[parent[i]]) for i in range(1, n)])
    assert np.allclose(edge, tau, atol=1e-9), "edges must all have hyperbolic length tau"

    # flat layout: depth d on the circle of radius d, children share their parent's arc
    lo, hi = np.zeros(n), np.zeros(n)
    hi[0] = 2 * np.pi
    e = np.zeros(n, dtype=complex)
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
    colors = plt.get_cmap("YlOrBr_r")(np.linspace(0.05, 0.75, depth + 1))
    for i in range(1, n):
        a.plot([e[i].real, e[parent[i]].real], [e[i].imag, e[parent[i]].imag], color=DIM, lw=0.6, zorder=1)
    a.scatter(e.real, e.imag, s=np.where(level < 3, 26, 7), c=colors[level], zorder=2, linewidths=0)
    for d in range(1, depth + 1):
        t = np.linspace(0, 2 * np.pi, 200); a.plot(d * np.cos(t), d * np.sin(t), color=RULE, lw=0.6, zorder=0)
    a.set_aspect("equal"); a.axis("off")
    a.set_title(f"flat plane: depth d on a circle of radius d\n{len(leaves)} leaves, {flat_gap:.2f} edge lengths apart")

    disk(b)
    for i in range(1, n):
        g = geodesic(z[parent[i]], z[i]); b.plot(g.real, g.imag, color=DIM, lw=0.6, zorder=1)
    b.scatter(z.real, z.imag, s=np.where(level < 3, 26, 7), c=colors[level], zorder=2, linewidths=0)
    b.set_title(f"Poincare disk: every edge has hyperbolic length {tau}\nnearest leaves stay {hyp_gap:.2f} apart ({hyp_gap / tau:.1f} edge lengths)")
    save(fig, "tree.webp")
    print(f"  tree: {n} nodes, {len(leaves)} leaves, flat leaf gap {flat_gap:.3f}, hyperbolic nearest-leaf distance {hyp_gap:.3f}")


def fig_capacity():
    r = np.linspace(0, 8, 400)
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    ax.plot(r, 2 * np.pi * np.sinh(r), color=GREEN, lw=2, label=r"hyperbolic circle, $2\pi\,\sinh r$")
    ax.plot(r[1:], 2 * np.pi * r[1:], color=RUST, lw=2, label=r"flat circle, $2\pi r$")
    d = np.arange(1, 9)
    ax.plot(d, 2.0 ** d, "o", color=AMBER, ms=5, label=r"nodes at depth $r$ of a binary tree, $2^r$")
    ax.plot(d, 3.0 ** d, "s", color=LILAC, ms=4.5, label=r"nodes at depth $r$ of a ternary tree, $3^r$")
    ax.set_yscale("log"); ax.set_xlabel("radius r  (tree depth, one unit per level)"); ax.set_ylabel("circumference  /  node count")
    ax.set_xlim(0, 8); ax.set_ylim(1, 2e4); ax.legend(loc="upper left")
    save(fig, "capacity.webp")


def fig_distance():
    r = np.linspace(0, 0.999, 600)
    fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4.3))
    a.plot(r, 2 * np.arctanh(r), color=GREEN, lw=2, label=r"hyperbolic, $2\,\mathrm{artanh}\,r$")
    a.plot(r, r, color=RUST, lw=2, label="Euclidean, r")
    a.set_xlabel("Euclidean radius r = |z|"); a.set_ylabel("distance from the origin"); a.set_xlim(0, 1); a.set_ylim(0, 8); a.legend(loc="upper left")
    a.set_title("distance to the centre")

    for deg, col in ((90, AMBER), (30, GREEN), (5, LILAC)):
        th = np.deg2rad(deg)
        u, v = r, r * np.exp(1j * th)
        hyp = np.arccosh(1 + 2 * np.abs(u - v) ** 2 / ((1 - np.abs(u) ** 2) * (1 - np.abs(v) ** 2)))
        b.plot(r, hyp, color=col, lw=2, label=f"hyperbolic, {deg}° apart")
        b.plot(r, np.abs(u - v), color=col, lw=1.2, ls=":", label=f"Euclidean, {deg}° apart")
    b.set_xlabel("common radius r of the two points"); b.set_ylabel("distance between them"); b.set_xlim(0, 1); b.set_ylim(0, 12)
    b.legend(loc="upper left", fontsize=8.5, ncol=1); b.set_title("two points at the same radius")
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
    a.plot(np.cos(t), np.sin(t), color=DIM, lw=1)
    a.scatter(es.real, es.imag, s=7, color=RUST, linewidths=0, label=f"u + v   ({outside:.0%} land outside the disk)")
    a.scatter(ms.real, ms.imag, s=7, color=GREEN, linewidths=0, label=r"u $\oplus_M$ v   (all inside)")
    a.set_aspect("equal"); a.set_xlim(-2.05, 2.05); a.set_ylim(-2.05, 2.05); a.axis("off")
    a.legend(loc="upper center", bbox_to_anchor=(0.5, 0.02), fontsize=9.5)
    a.set_title(f"{m} random pairs u, v in the disk")

    disk(b)
    shift = 0.55 * np.exp(1j * np.deg2rad(25))
    for rad in np.tanh(np.arange(0.5, 3.01, 0.5) / 2):            # circles at equal hyperbolic spacing
        c = rad * np.exp(1j * t)
        b.plot(c.real, c.imag, color=RULE, lw=0.8); w = mobius_add(shift, c); b.plot(w.real, w.imag, color=AMBER, lw=1)
    for ang in np.arange(0, 2 * np.pi, np.pi / 8):                 # diameters
        c = np.linspace(-0.999, 0.999, 300) * np.exp(1j * ang)
        b.plot(c.real, c.imag, color=RULE, lw=0.8); w = mobius_add(shift, c); b.plot(w.real, w.imag, color=LILAC, lw=1)
    b.plot([0], [0], "o", color=DIM, ms=4); b.plot([shift.real], [shift.imag], "o", color=GREEN, ms=5)
    b.set_title(r"a polar grid moved by z $\mapsto$ a $\oplus_M$ z")
    save(fig, "mobius.webp")
    print(f"  mobius: {outside:.3f} of Euclidean sums leave the disk, max |u (+) v| = {np.abs(ms).max():.4f}")


def fig_oversmoothing():
    """Measured: mean-neighbour aggregation (no weights, no nonlinearity) on a tree, random features."""
    parent, level = build_tree(7)
    n = len(parent)
    A = np.eye(n)
    for i in range(1, n):
        A[i, parent[i]] = A[parent[i], i] = 1
    P = A / A.sum(1, keepdims=True)                 # row-normalised adjacency with self loops
    L = 32

    def mad(X):
        Xn = X / np.linalg.norm(X, axis=1, keepdims=True)
        C = Xn @ Xn.T
        return float((1 - C)[~np.eye(n, dtype=bool)].mean())

    def spread(X):
        """Variance of the features across nodes, summed over feature dimensions."""
        return float(X.var(axis=0).sum())

    runs = {"signed features, N(0,1)": lambda g: g.normal(size=(n, 64)), "non-negative features, |N(0,1)|": lambda g: np.abs(g.normal(size=(n, 64)))}
    fig, (av, am) = plt.subplots(1, 2, figsize=(11, 4.4))
    out = {}
    for (name, make), col in zip(runs.items(), (AMBER, GREEN)):
        mads, vars_ = [], []
        for seed in range(10):
            X = make(np.random.default_rng(seed)); c = [mad(X)]; v0 = spread(X); v = [1.0]
            for _ in range(L):
                X = P @ X; c.append(mad(X)); v.append(spread(X) / v0)
            mads.append(c); vars_.append(v)
        for ax, data in ((am, np.array(mads)), (av, np.array(vars_))):
            ax.fill_between(range(L + 1), data.min(0), data.max(0), color=col, alpha=0.18, lw=0)
            ax.plot(range(L + 1), data.mean(0), color=col, lw=2, marker="o", ms=2.5, label=name)
        out[name] = (np.array(mads).mean(0), np.array(vars_).mean(0))
    for ax in (av, am):
        ax.set_yscale("log"); ax.set_xlabel("number of aggregation layers"); ax.set_xlim(0, L)
    av.set_ylabel("variance across nodes, relative to layer 0"); av.set_title("node features lose variance"); av.legend(loc="upper right", fontsize=9)
    am.set_ylabel("MAD  (mean pairwise cosine distance)"); am.set_title("mean pairwise cosine distance")
    save(fig, "oversmoothing.webp")
    for k, (m_, v_) in out.items():
        print(f"  oversmoothing [{k}], {n} nodes")
        print("    MAD:      " + ", ".join(f"L{l}={m_[l]:.3f}" for l in (0, 1, 2, 4, 8, 16, 32)))
        print("    variance: " + ", ".join(f"L{l}={v_[l]:.4f}" for l in (0, 1, 2, 4, 8, 16, 32)))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    fig_tree(); fig_capacity(); fig_distance(); fig_mobius(); fig_oversmoothing()
