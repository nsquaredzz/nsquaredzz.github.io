"""Datasets. Nothing is committed; everything is downloaded into data/ on first use."""
from __future__ import annotations

import os
import pickle
import sys
import urllib.request
from collections import deque

import numpy as np
import scipy.sparse as sp

DATA = os.path.join(os.path.dirname(__file__), "..", "data")


def _fetch(url: str, path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        print("downloading", url, file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path


# ---------------------------------------------------------------- WordNet mammals
def wordnet_subtree(root_name: str = "mammal.n.01") -> dict:
    """Hypernymy below one WordNet noun synset (Miller 1995), as used by Nickel & Kiela (2017).

    Returns names, direct edges (child, parent), transitive-closure pairs (node, ancestor),
    depth below the root (shortest path) and a branch label (the ancestor two steps below the root).
    """
    import nltk

    nltk.data.path.insert(0, os.path.join(DATA, "nltk"))
    try:
        from nltk.corpus import wordnet as wn
        wn.synset(root_name)
    except LookupError:
        nltk.download("wordnet", download_dir=os.path.join(DATA, "nltk"), quiet=True)
        from nltk.corpus import wordnet as wn

    root = wn.synset(root_name)
    nodes = sorted({root} | set(root.closure(lambda s: s.hyponyms())), key=lambda s: s.name())
    index = {s: i for i, s in enumerate(nodes)}
    direct = sorted({(index[s], index[h]) for s in nodes for h in s.hypernyms() if h in index})
    closure = sorted({(index[s], index[a]) for s in nodes for a in s.closure(lambda t: t.hypernyms()) if a in index})

    children = [[] for _ in nodes]
    for c, p in direct:
        children[p].append(c)
    depth = np.full(len(nodes), -1)
    parent = np.full(len(nodes), -1)
    depth[index[root]] = 0
    queue = deque([index[root]])
    while queue:
        u = queue.popleft()
        for c in children[u]:
            if depth[c] < 0:
                depth[c], parent[c] = depth[u] + 1, u
                queue.append(c)

    def ancestor_at(u, level):
        while depth[u] > level:
            u = parent[u]
        return u if depth[u] == level else -1

    branch = np.array([ancestor_at(u, 2) if depth[u] >= 2 else -1 for u in range(len(nodes))])
    return {
        "names": [s.name() for s in nodes],
        "direct": np.array(direct),
        "closure": np.array(closure),
        "depth": depth,
        "branch": branch,
        "root": index[root],
    }


# ---------------------------------------------------------------- node-classification graphs
def _normalise_rows(x: np.ndarray) -> np.ndarray:
    s = x.sum(1, keepdims=True)
    s[s == 0] = 1
    return x / s


def load_cora() -> dict:
    """Cora citation graph with the public Planetoid split (Sen et al. 2008; Yang et al. 2016)."""
    base = "https://raw.githubusercontent.com/kimiyoung/planetoid/master/data/ind.cora."
    objs = {}
    for name in ("x", "y", "tx", "ty", "allx", "ally", "graph"):
        with open(_fetch(base + name, os.path.join(DATA, "cora", "ind.cora." + name)), "rb") as f:
            objs[name] = pickle.load(f, encoding="latin1")
    test_idx = np.loadtxt(_fetch(base + "test.index", os.path.join(DATA, "cora", "ind.cora.test.index")), dtype=int)
    order = np.sort(test_idx)
    feats = sp.vstack((objs["allx"], objs["tx"])).tolil()
    feats[test_idx, :] = feats[order, :]
    labels = np.vstack((objs["ally"], objs["ty"]))
    labels[test_idx, :] = labels[order, :]
    n = feats.shape[0]
    edges = {(min(u, v), max(u, v)) for u, nb in objs["graph"].items() for v in nb if u != v}
    return {
        "name": "cora",
        "x": _normalise_rows(np.asarray(feats.todense(), dtype=np.float32)),
        "y": labels.argmax(1),
        "edges": np.array(sorted(edges)),
        "n": n,
        "split": {"train": np.arange(140), "val": np.arange(140, 640), "test": order},
    }


def load_disease() -> dict:
    """Disease propagation tree from the HGCN release (Chami et al. 2019). Splits are drawn per seed."""
    base = "https://raw.githubusercontent.com/HazyResearch/hgcn/master/data/disease_nc/disease_nc."
    d = os.path.join(DATA, "disease_nc")
    edges = np.loadtxt(_fetch(base + "edges.csv", os.path.join(d, "edges.csv")), delimiter=",", dtype=int)
    feats = sp.load_npz(_fetch(base + "feats.npz", os.path.join(d, "feats.npz")))
    labels = np.load(_fetch(base + "labels.npy", os.path.join(d, "labels.npy")))
    edges = {(min(u, v), max(u, v)) for u, v in edges if u != v}
    return {
        "name": "disease",
        "x": _normalise_rows(np.asarray(feats.todense(), dtype=np.float32)),
        "y": labels.astype(int),
        "edges": np.array(sorted(edges)),
        "n": feats.shape[0],
        "split": None,
    }


def load_disease_lp() -> dict:
    """Disease tree for link prediction from the HGCN release (Chami et al. 2019): 2,665 nodes, 11 real features."""
    base = "https://raw.githubusercontent.com/HazyResearch/hgcn/master/data/disease_lp/disease_lp."
    d = os.path.join(DATA, "disease_lp")
    edges = np.loadtxt(_fetch(base + "edges.csv", os.path.join(d, "edges.csv")), delimiter=",", dtype=int)
    feats = np.asarray(sp.load_npz(_fetch(base + "feats.npz", os.path.join(d, "feats.npz"))).todense(), dtype=np.float32)
    feats = (feats - feats.mean(0)) / (feats.std(0) + 1e-8)                 # standardise each feature
    edges = np.array(sorted({(min(u, v), max(u, v)) for u, v in edges if u != v}))
    return {"name": "disease_lp", "x": feats, "edges": edges, "n": feats.shape[0]}


def edge_split(n: int, edges: np.ndarray, seed: int, val: float = 0.05, test: float = 0.10) -> dict:
    """Hold out 5 % of edges for validation and 10 % for testing, with as many sampled non-edges each."""
    rng = np.random.default_rng(seed)
    perm = rng.permutation(len(edges))
    nv, nt = int(round(val * len(edges))), int(round(test * len(edges)))
    known = {(int(u), int(v)) for u, v in edges}
    neg = set()
    while len(neg) < nv + nt:
        u, v = sorted(int(t) for t in rng.integers(0, n, 2))
        if u != v and (u, v) not in known:
            neg.add((u, v))
    neg = np.array(sorted(neg))[rng.permutation(nv + nt)]
    return {"val_pos": edges[perm[:nv]], "test_pos": edges[perm[nv:nv + nt]], "train": edges[perm[nv + nt:]],
            "val_neg": neg[:nv], "test_neg": neg[nv:]}


def random_split(n: int, y: np.ndarray, seed: int, val: float = 0.10, test: float = 0.60) -> dict:
    """The 30/10/60 protocol of Chami et al. (2019), stratified by class."""
    rng = np.random.default_rng(seed)
    out = {"train": [], "val": [], "test": []}
    for c in np.unique(y):
        idx = rng.permutation(np.where(y == c)[0])
        nv, nt = int(round(val * len(idx))), int(round(test * len(idx)))
        out["val"] += idx[:nv].tolist()
        out["test"] += idx[nv:nv + nt].tolist()
        out["train"] += idx[nv + nt:].tolist()
    return {k: np.array(sorted(v)) for k, v in out.items()}


def mean_adjacency(n: int, edges: np.ndarray):
    """Row-stochastic D^-1 (A + I) as a torch sparse tensor."""
    import torch

    rows = np.concatenate([edges[:, 0], edges[:, 1], np.arange(n)])
    cols = np.concatenate([edges[:, 1], edges[:, 0], np.arange(n)])
    deg = np.bincount(rows, minlength=n).astype(np.float32)
    vals = 1.0 / deg[rows]
    return torch.sparse_coo_tensor(np.stack([rows, cols]), vals, (n, n)).coalesce()
