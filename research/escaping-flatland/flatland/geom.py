"""Geometry used by the essay, written so that every operation is well defined.

Three spaces share one interface (exp0, log0, dist, midpoint):

  Euclid    R^n.
  Ball      the Poincare ball in R^n, curvature -1 (Nickel & Kiela 2017, Ganea et al. 2018).
  PolyDisk  a product of H Poincare disks, D^H, written as H complex coordinates.
            This is the reading under which the essay's one-complex-dimension formulas
            (Mobius addition, phase interaction) are literally correct, coordinate by coordinate.

Conventions. The metric on the unit ball is ds^2 = 4|dx|^2 / (1 - |x|^2)^2, so
d(0, x) = 2 artanh|x| and exp0(v) = tanh(|v|) v/|v| lies at distance 2|v| from the origin.
PolyDisk tensors have shape (..., H, 2): H disks, each stored as (real, imaginary).
"""
from __future__ import annotations

import torch


def _tiny(x: torch.Tensor) -> float:
    return 1e-15 if x.dtype == torch.float64 else 1e-7


def _max_norm(x: torch.Tensor) -> float:
    return 1 - 1e-10 if x.dtype == torch.float64 else 1 - 1e-5


def _norm(x: torch.Tensor) -> torch.Tensor:
    return x.norm(dim=-1, keepdim=True).clamp_min(_tiny(x))


def _acosh1p(delta: torch.Tensor) -> torch.Tensor:
    """arccosh(1 + delta), accurate for small delta."""
    delta = delta.clamp_min(_tiny(delta))
    return torch.log1p(delta + torch.sqrt(delta * (delta + 2)))


def project(x: torch.Tensor) -> torch.Tensor:
    """Pull a point back inside the open unit ball (norm over the last axis)."""
    n = _norm(x)
    m = _max_norm(x)
    return torch.where(n > m, x / n * m, x)


def ball_exp0(v: torch.Tensor) -> torch.Tensor:
    n = _norm(v)
    return project(torch.tanh(n) * v / n)


def ball_log0(x: torch.Tensor) -> torch.Tensor:
    n = _norm(x).clamp_max(_max_norm(x))
    return torch.atanh(n) * x / n


def ball_dist(x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    """Poincare distance, norm over the last axis. Equation 2 of the essay."""
    d2 = (x - y).pow(2).sum(-1)
    den = (1 - x.pow(2).sum(-1)) * (1 - y.pow(2).sum(-1))
    return _acosh1p(2 * d2 / den.clamp_min(_tiny(x)))


def ball_mobius_add(x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    """Mobius addition in the ball of any dimension (Ungar). For n = 2 it equals (x + y)/(1 + conj(x) y)."""
    xy = (x * y).sum(-1, keepdim=True)
    x2 = x.pow(2).sum(-1, keepdim=True)
    y2 = y.pow(2).sum(-1, keepdim=True)
    num = (1 + 2 * xy + y2) * x + (1 - x2) * y
    return project(num / (1 + 2 * xy + x2 * y2).clamp_min(_tiny(x)))


def complex_mobius_add(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """Equation 3 of the essay for complex tensors: a (+) b = (a + b) / (1 + conj(a) b)."""
    return (a + b) / (1 + a.conj() * b)


def gyromidpoint(x: torch.Tensor, w: torch.Tensor) -> torch.Tensor:
    """Weighted Einstein midpoint, expressed in Poincare coordinates (the Mobius gyromidpoint).

    x: (..., K, n) points in the ball, w: (..., K) non-negative weights. Returns (..., n).
    In Klein coordinates this is sum(w g k) / sum(w g) with g the Lorentz factor; mapped back
    to the ball it reads  (1/2) (x)  sum(w lam x) / sum(w (lam - 1)),  lam = 2 / (1 - |x|^2).
    It does not depend on the order of the points and commutes with every isometry of the ball.
    """
    lam = 2 / (1 - x.pow(2).sum(-1, keepdim=True)).clamp_min(_tiny(x))
    num = (w.unsqueeze(-1) * lam * x).sum(-2)
    den = (w.unsqueeze(-1) * (lam - 1)).sum(-2).clamp_min(_tiny(x))
    return _half(num / den)


def _half(y: torch.Tensor) -> torch.Tensor:
    """Mobius scalar multiplication by 1/2: tanh(artanh|y| / 2) y/|y| = y / (1 + sqrt(1 - |y|^2))."""
    y = project(y)
    return y / (1 + torch.sqrt((1 - y.pow(2).sum(-1, keepdim=True)).clamp_min(0)))


def sparse_gyromidpoint(P: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
    """Gyromidpoint of each node's neighbourhood. P: sparse row-stochastic (N, N). x: (N, ..., n)."""
    shape = x.shape
    lam = 2 / (1 - x.pow(2).sum(-1, keepdim=True)).clamp_min(_tiny(x))
    num = torch.sparse.mm(P, (lam * x).reshape(shape[0], -1)).reshape(shape)
    den = torch.sparse.mm(P, (lam - 1).reshape(shape[0], -1)).reshape(*shape[:-1], 1)
    return _half(num / den.clamp_min(_tiny(x)))


class Euclid:
    name = "euclid"

    @staticmethod
    def exp0(v):
        return v

    @staticmethod
    def log0(x):
        return x

    @staticmethod
    def dist(x, y):
        return ((x - y).pow(2).sum(-1) + _tiny(x)).sqrt()


class EuclidSq(Euclid):
    """Squared Euclidean distance, the Euclidean baseline of Nickel & Kiela (2017)."""

    name = "euclid_sq"

    @staticmethod
    def dist(x, y):
        return (x - y).pow(2).sum(-1)


class Ball:
    name = "ball"
    exp0 = staticmethod(ball_exp0)
    log0 = staticmethod(ball_log0)
    dist = staticmethod(ball_dist)


class PolyDisk:
    """D^H. A flat (..., 2H) tensor is read as H (real, imaginary) pairs."""

    name = "polydisk"

    @staticmethod
    def pairs(x):
        return x.reshape(*x.shape[:-1], -1, 2)

    @staticmethod
    def flat(x):
        return x.reshape(*x.shape[:-2], -1)

    @classmethod
    def exp0(cls, v):
        return cls.flat(ball_exp0(cls.pairs(v)))

    @classmethod
    def log0(cls, x):
        return cls.flat(ball_log0(cls.pairs(x)))

    @classmethod
    def dist(cls, x, y):
        """Product metric: square root of the sum of squared disk distances."""
        d = ball_dist(cls.pairs(x), cls.pairs(y))
        return (d.pow(2).sum(-1) + _tiny(x)).sqrt()

    @classmethod
    def radius(cls, x):
        """Hyperbolic distance from the origin."""
        return cls.dist(x, torch.zeros_like(x))

    @classmethod
    def magnitude_phase(cls, x):
        p = cls.pairs(x)
        return p.norm(dim=-1), torch.atan2(p[..., 1], p[..., 0])


SPACES = {s.name: s for s in (Euclid, EuclidSq, Ball, PolyDisk)}


def complex_lift(w: torch.Tensor) -> torch.Tensor:
    """Corrected Equation 1. w: (..., H, 2) complex pre-activations W x. Returns points of D^H.

    z_k = tanh|w_k| exp(i arg w_k): the exponential map at the centre of each disk. The magnitude
    tanh|w_k| is always below 1, which the original tanh(Re) + i tanh(Im) did not guarantee.
    """
    return ball_exp0(w)


def original_lift(w: torch.Tensor) -> torch.Tensor:
    """The lift as first written: tanh applied to real and imaginary parts separately."""
    return torch.tanh(w)
