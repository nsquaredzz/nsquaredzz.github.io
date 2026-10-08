"""Three message-passing networks of equal width, one per space.

    EuclidGCN     h' = mean_neighbours( W relu(h) )                           Kipf & Welling 2017, mean aggregation
    BallHGCN      z' = exp0( mean_neighbours( log0( W (x) relu(z) (+) b ) ) )   HGCN (Chami et al. 2019), curvature fixed at -1
    PolyDiskGNN   z' = gyromidpoint_neighbours( W (x) modrelu(z) )            the essay's layer, made well defined

In PolyDiskGNN the weights are complex, W (x) z = exp0(W log0 z) is the Mobius matrix-vector
product of Ganea et al. (2018) taken disk by disk, and the neighbourhood is combined with the
Einstein midpoint (gyromidpoint), which does not depend on the order of the neighbours.

`alpha` > 0 adds an initial-residual connection to the layer-0 state after every aggregation
(GCNII, Chen et al. 2020), done with a weighted mean in each space's own sense.
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from . import geom as G


class ComplexLinear(nn.Module):
    """A complex H x H matrix acting on (N, H, 2) tensors."""

    def __init__(self, h: int):
        super().__init__()
        bound = math.sqrt(3 / (2 * h))                 # complex Glorot: E|W_jk|^2 = 1 / h
        self.A = nn.Parameter(torch.empty(h, h).uniform_(-bound, bound))
        self.B = nn.Parameter(torch.empty(h, h).uniform_(-bound, bound))
        self.bias = nn.Parameter(torch.zeros(h, 2))

    def forward(self, t):
        re, im = t[..., 0], t[..., 1]
        return torch.stack([re @ self.A.T - im @ self.B.T, re @ self.B.T + im @ self.A.T], dim=-1) + self.bias


class ModReLU(nn.Module):
    """relu(|t| + b) t/|t|: gates the magnitude and leaves the phase alone (Arjovsky et al. 2016)."""

    def __init__(self, h: int):
        super().__init__()
        self.b = nn.Parameter(torch.zeros(h, 1))

    def forward(self, t):
        mag = t.norm(dim=-1, keepdim=True).clamp_min(1e-7)
        return F.relu(mag + self.b) / mag * t


class _Base(nn.Module):
    """Shared skeleton. With L layers the network is

        s_1 = AGG( lift(W_1 x) )
        s_l = AGG( W_l (x) act(s_{l-1}) )      for l = 2 .. L
        logits = W_out log0(s_L)

    which for the Euclidean space and L = 2 is the GCN of Kipf & Welling (2017) with mean
    normalisation: P relu(P X W_1) W_2, the last weight written as a product W_2 W_out.
    """

    def __init__(self, in_dim, hid, n_class, depth, alpha=0.0, dropout=0.5):
        super().__init__()
        self.depth, self.alpha, self.p, self.hid = depth, alpha, dropout, hid
        self.inp = nn.Linear(in_dim, hid)
        self.out = nn.Linear(hid, n_class)

    def reset(self):
        """Glorot initialisation for every real weight matrix, as in Kipf & Welling (2017)."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
        return self

    def drop(self, t):
        return F.dropout(t, self.p, self.training)

    def forward(self, x, P):
        return self.out(self.drop(self.tangent(self.embed(x, P)[-1])))


class EuclidGCN(_Base):
    space = "euclid"
    activation = "relu"

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.layers = nn.ModuleList([nn.Linear(self.hid, self.hid) for _ in range(self.depth - 1)])
        if self.activation == "modrelu":
            self.acts = nn.ModuleList([ModReLU(self.hid // 2) for _ in range(self.depth - 1)])

    def act(self, h, i):
        if self.activation == "relu":
            return F.relu(h)
        return self.acts[i](h.reshape(-1, self.hid // 2, 2)).flatten(1)     # coordinates gated in pairs, as in the disks model

    def tangent(self, h):
        return h

    def mix(self, a, h0):
        return (1 - self.alpha) * a + self.alpha * h0 if self.alpha > 0 else a

    def embed(self, x, P):
        h0 = self.inp(self.drop(x))
        h = self.mix(torch.sparse.mm(P, h0), h0)
        states = [h0, h]
        for i, lin in enumerate(self.layers):
            h = self.mix(torch.sparse.mm(P, lin(self.drop(self.act(h, i)))), h0)
            states.append(h)
        return states


class EuclidModReLU(EuclidGCN):
    """Control: flat geometry with the activation of the disks model."""

    activation = "modrelu"


class BallHGCN(_Base):
    space = "ball"

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.layers = nn.ModuleList([nn.Linear(self.hid, self.hid, bias=False) for _ in range(self.depth - 1)])
        self.biases = nn.ParameterList([nn.Parameter(torch.zeros(self.hid)) for _ in range(self.depth)])

    def tangent(self, z):
        return G.ball_log0(z)

    def agg(self, m, bias, t0):
        m = G.ball_mobius_add(m, G.ball_exp0(bias).expand_as(m))                # (+) b
        t = torch.sparse.mm(P_holder[0], G.ball_log0(m))                        # mean in the tangent space at the origin
        if self.alpha > 0:
            t = (1 - self.alpha) * t + self.alpha * t0
        return G.ball_exp0(t)

    def embed(self, x, P):
        P_holder[0] = P
        t0 = self.inp(self.drop(x))
        z0 = G.ball_exp0(t0)
        z = self.agg(z0, self.biases[0], t0)
        states = [z0, z]
        for lin, b in zip(self.layers, self.biases[1:]):
            m = G.ball_exp0(lin(self.drop(F.relu(G.ball_log0(z)))))             # W (x) act(z)
            z = self.agg(m, b, t0)
            states.append(z)
        return states


P_holder = [None]


class PolyDiskGNN(_Base):
    space = "polydisk"

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.h = self.hid // 2
        self.layers = nn.ModuleList([ComplexLinear(self.h) for _ in range(self.depth - 1)])
        self.acts = nn.ModuleList([ModReLU(self.h) for _ in range(self.depth - 1)])

    def tangent(self, z):
        return G.ball_log0(z).flatten(1)

    def agg(self, m, P, z0):
        a = G.sparse_gyromidpoint(P, m)                                         # Einstein midpoint of the neighbourhood
        if self.alpha > 0:
            w = torch.tensor([1 - self.alpha, self.alpha]).expand(*a.shape[:-1], 2)
            a = G.gyromidpoint(torch.stack([a, z0], dim=-2), w)
        return a

    def embed(self, x, P):
        w = self.inp(self.drop(x)).reshape(-1, self.h, 2)                       # W x as H complex numbers
        z0 = G.complex_lift(w)                                                  # corrected Equation 1
        z = self.agg(z0, P, z0)
        states = [z0, z]
        for lin, act in zip(self.layers, self.acts):
            m = G.ball_exp0(lin(self.drop(act(G.ball_log0(z)))))                # W (x) act(z), complex W, phase-preserving act
            z = self.agg(m, P, z0)
            states.append(z)
        return states


MODELS = {"euclid": EuclidGCN, "euclid_modrelu": EuclidModReLU, "ball": BallHGCN, "polydisk": PolyDiskGNN}


def mad(t: torch.Tensor, chunk: int = 2048) -> float:
    """Mean average distance of Chen et al. (2020): mean cosine distance over all pairs of distinct nodes.

    For hyperbolic models t is the tangent vector at the origin, log0(z). Two all-zero rows count as distance 0.
    """
    n = t.shape[0]
    norm = t.norm(dim=1, keepdim=True)
    u = t / norm.clamp_min(1e-12)
    zero = (norm.squeeze(1) < 1e-12)
    total = 0.0
    for i in range(0, n, chunk):
        d = 1 - u[i:i + chunk] @ u.T
        both_zero = zero[i:i + chunk, None] & zero[None, :]
        d = torch.where(both_zero, torch.zeros_like(d), d)
        total += float(d.sum())
    return total / (n * (n - 1))


def mean_pairwise_distance(space: str, state: torch.Tensor, sample: int = 1500, seed: int = 0) -> float:
    """Mean distance between nodes in the model's own metric, on a fixed random sample of nodes."""
    n = state.shape[0]
    idx = torch.randperm(n, generator=torch.Generator().manual_seed(seed))[:sample]
    s = state[idx].double()
    if space == "euclid":
        d = G.Euclid.dist(s[:, None], s[None])
    elif space == "ball":
        d = G.ball_dist(s[:, None], s[None])
    else:
        d = G.ball_dist(s[:, None], s[None]).pow(2).sum(-1).sqrt()
    m = len(idx)
    return float((d.sum() - d.diagonal().sum()) / (m * (m - 1)))
