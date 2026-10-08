"""Checks for every mathematical statement the essay makes about the geometry."""
import math
import os
import sys

import pytest
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from flatland import geom as G  # noqa: E402



@pytest.fixture(autouse=True)
def _dtype():
    old = torch.get_default_dtype()
    torch.set_default_dtype(torch.float64)
    yield
    torch.set_default_dtype(old)


def rand_ball(*shape, max_r=0.95, seed=0):
    g = torch.Generator().manual_seed(seed)
    v = torch.randn(*shape, generator=g)
    r = torch.rand(*shape[:-1], 1, generator=g) * max_r
    return v / v.norm(dim=-1, keepdim=True) * r


def as_complex(x):
    return torch.complex(x[..., 0], x[..., 1])


def test_exp_log_are_inverse():
    v = torch.randn(200, 6, generator=torch.Generator().manual_seed(1))
    assert torch.allclose(G.ball_log0(G.ball_exp0(v)), v, atol=1e-9)
    assert torch.allclose(G.PolyDisk.log0(G.PolyDisk.exp0(v)), v, atol=1e-9)


def test_distance_from_origin_is_two_artanh():
    x = rand_ball(100, 4)
    assert torch.allclose(G.ball_dist(x, torch.zeros_like(x)), 2 * torch.atanh(x.norm(dim=-1)), atol=1e-9)
    v = torch.randn(100, 4, generator=torch.Generator().manual_seed(2))
    assert torch.allclose(G.ball_dist(G.ball_exp0(v), torch.zeros_like(v)), 2 * v.norm(dim=-1), atol=1e-8)


def test_distance_formula_matches_mobius_form():
    x, y = rand_ball(300, 5, seed=3), rand_ball(300, 5, seed=4)
    alt = 2 * torch.atanh(G.ball_mobius_add(-x, y).norm(dim=-1))
    assert torch.allclose(G.ball_dist(x, y), alt, atol=1e-8)


def test_original_lift_can_leave_the_disk_and_corrected_lift_cannot():
    w = torch.randn(100_000, 1, 2, generator=torch.Generator().manual_seed(5)) * 2
    old = G.original_lift(w).norm(dim=-1)
    new = G.complex_lift(w).norm(dim=-1)
    assert old.max() > 1.3            # tanh(a) + i tanh(b) reaches towards sqrt(2)
    assert (old >= 1).double().mean() > 0.3
    assert new.max() < 1


def test_complex_formula_equals_ball_formula_in_two_dimensions():
    x, y = rand_ball(200, 2, seed=6), rand_ball(200, 2, seed=7)
    c = G.complex_mobius_add(as_complex(x), as_complex(y))
    b = as_complex(G.ball_mobius_add(x, y))
    assert torch.allclose(c, b, atol=1e-10)


def test_mobius_addition_is_not_commutative_but_differs_only_by_a_phase():
    a, b = as_complex(rand_ball(500, 2, seed=8)), as_complex(rand_ball(500, 2, seed=9))
    ab, ba = G.complex_mobius_add(a, b), G.complex_mobius_add(b, a)
    assert (ab - ba).abs().max() > 0.1
    assert torch.allclose(ab.abs(), ba.abs(), atol=1e-12)
    gyr = (1 + a * b.conj()) / (1 + a.conj() * b)         # Ungar's gyration, a unit complex number
    assert torch.allclose(gyr.abs(), torch.ones_like(gyr.abs()), atol=1e-12)
    assert torch.allclose(ab, gyr * ba, atol=1e-12)


def test_mobius_addition_is_not_associative():
    a, b, c = (as_complex(rand_ball(500, 2, seed=s)) for s in (10, 11, 12))
    left = G.complex_mobius_add(G.complex_mobius_add(a, b), c)
    right = G.complex_mobius_add(a, G.complex_mobius_add(b, c))
    assert (left - right).abs().max() > 0.1


def test_folding_mobius_addition_over_neighbours_depends_on_order():
    """Summing five neighbours with (+) gives a different point for different orders.

    Measured in hyperbolic distance, because near the rim a large hyperbolic gap is a small Euclidean one.
    """
    pts = rand_ball(5, 2, max_r=0.6, seed=13)

    def fold(order):
        acc = pts[order[0]]
        for i in order[1:]:
            acc = G.ball_mobius_add(acc, pts[i])
        return acc

    g = torch.Generator().manual_seed(0)
    results = torch.stack([fold(torch.randperm(5, generator=g).tolist()) for _ in range(24)])
    spread = G.ball_dist(results[:, None], results[None]).max()
    assert spread > 0.5, spread
    # the gyromidpoint of the same five points is a single point whatever the order
    mids = torch.stack([G.gyromidpoint(pts[torch.randperm(5, generator=g)], torch.ones(5)) for _ in range(24)])
    assert G.ball_dist(mids[:, None], mids[None]).max() < 1e-7


def test_gyromidpoint_of_two_points_is_the_geodesic_midpoint():
    x, y = rand_ball(300, 3, seed=14), rand_ball(300, 3, seed=15)
    m = G.gyromidpoint(torch.stack([x, y], dim=-2), torch.ones(300, 2))
    dxm, dym, dxy = G.ball_dist(x, m), G.ball_dist(y, m), G.ball_dist(x, y)
    assert torch.allclose(dxm, dym, atol=1e-8)
    assert torch.allclose(dxm + dym, dxy, atol=1e-8)


def test_gyromidpoint_ignores_order_and_commutes_with_isometries():
    x = rand_ball(50, 7, 2, seed=16)
    w = torch.rand(50, 7, generator=torch.Generator().manual_seed(17))
    m = G.gyromidpoint(x, w)
    perm = torch.randperm(7, generator=torch.Generator().manual_seed(18))
    assert torch.allclose(G.gyromidpoint(x[:, perm], w[:, perm]), m, atol=1e-10)

    # rotation about the centre
    th = 0.7
    R = torch.tensor([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    assert torch.allclose(G.gyromidpoint(x @ R.T, w), m @ R.T, atol=1e-10)

    # hyperbolic translation z -> a (+) z
    a = rand_ball(50, 1, 2, seed=19)
    moved = G.ball_mobius_add(a.expand_as(x), x)
    assert torch.allclose(G.gyromidpoint(moved, w), G.ball_mobius_add(a[:, 0], m), atol=1e-8)


def test_sparse_gyromidpoint_matches_dense():
    n, h = 12, 3
    x = rand_ball(n, h, 2, seed=20)
    A = (torch.rand(n, n, generator=torch.Generator().manual_seed(21)) < 0.4).double() + torch.eye(n)
    A = (A > 0).double()
    P = A / A.sum(1, keepdim=True)
    got = G.sparse_gyromidpoint(P.to_sparse(), x)
    for u in range(n):
        idx = A[u].nonzero().squeeze(-1)
        want = G.gyromidpoint(x[idx].transpose(0, 1), torch.full((h, len(idx)), 1.0))
        assert torch.allclose(got[u], want, atol=1e-10)


def test_polydisk_distance_is_the_product_metric():
    x, y = rand_ball(100, 4, 2, seed=22), rand_ball(100, 4, 2, seed=23)
    d = G.PolyDisk.dist(G.PolyDisk.flat(x), G.PolyDisk.flat(y))
    want = G.ball_dist(x, y).pow(2).sum(-1).sqrt()
    assert torch.allclose(d, want, atol=1e-7)


def test_nothing_in_the_geometry_forbids_collapse():
    """A constant map sends every node to one point: every pairwise distance is then zero."""
    z = G.PolyDisk.exp0(torch.zeros(40, 8) + 0.3)
    assert G.PolyDisk.dist(z[:, None], z[None]).max() < 1e-6


def test_averaging_never_increases_the_spread():
    """One round of gyromidpoint averaging over a connected graph shrinks the largest pairwise distance."""
    n = 30
    x = rand_ball(n, 1, 2, seed=24)
    A = torch.ones(n, n)
    P = (A / n).to_sparse()
    before = G.ball_dist(x[:, None], x[None]).max()
    after_pts = G.sparse_gyromidpoint(P, x)
    after = G.ball_dist(after_pts[:, None], after_pts[None]).max()
    assert after < 1e-6 < before
