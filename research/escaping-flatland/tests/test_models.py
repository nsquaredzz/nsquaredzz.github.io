"""The three networks: outputs are finite, hyperbolic states stay inside their space, and the
Euclidean model with two layers is the GCN of Kipf & Welling (2017) with mean normalisation."""
import os
import sys

import pytest
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from flatland import geom as G  # noqa: E402
from flatland.models import MODELS, mad  # noqa: E402


@pytest.fixture(autouse=True)
def _dtype():
    old = torch.get_default_dtype()
    torch.set_default_dtype(torch.float32)
    yield
    torch.set_default_dtype(old)


def toy(n=40, f=12, seed=0):
    g = torch.Generator().manual_seed(seed)
    A = (torch.rand(n, n, generator=g) < 0.1).float()
    A = ((A + A.T + torch.eye(n)) > 0).float()
    return torch.rand(n, f, generator=g), (A / A.sum(1, keepdim=True)).to_sparse()


def test_every_model_runs_at_every_depth_and_stays_in_its_space():
    x, P = toy()
    for name, cls in MODELS.items():
        for depth in (1, 2, 5, 12):
            for alpha in (0.0, 0.1):
                torch.manual_seed(0)
                m = cls(x.shape[1], 16, 3, depth, alpha=alpha, dropout=0.0).reset().eval()
                states = m.embed(x, P)
                assert len(states) == depth + 1
                assert torch.isfinite(m(x, P)).all(), (name, depth, alpha)
                if cls.space != "euclid":
                    for s in states:
                        assert s.norm(dim=-1).max() < 1, (name, depth)


def test_two_layer_euclidean_model_is_a_gcn():
    x, P = toy()
    torch.manual_seed(1)
    m = MODELS["euclid"](x.shape[1], 16, 3, 2, alpha=0.0, dropout=0.0).reset().eval()
    Pd = P.to_dense()
    h1 = Pd @ m.inp(x)                               # P X W_1
    want = m.out(Pd @ m.layers[0](F.relu(h1)))       # P relu(.) W_2, then W_out
    assert torch.allclose(m(x, P), want, atol=1e-5)


def test_disks_model_does_not_depend_on_node_order():
    x, P = toy()
    torch.manual_seed(2)
    m = MODELS["polydisk"](x.shape[1], 16, 3, 4, alpha=0.1, dropout=0.0).reset().eval()
    perm = torch.randperm(x.shape[0], generator=torch.Generator().manual_seed(3))
    Pp = P.to_dense()[perm][:, perm].to_sparse()
    assert torch.allclose(m(x, P)[perm], m(x[perm], Pp), atol=1e-4)


def test_mad_is_zero_for_identical_rows_and_one_for_orthogonal_rows():
    assert mad(torch.ones(10, 4)) < 1e-6
    assert abs(mad(torch.eye(6)) - 1) < 1e-6
    assert mad(torch.zeros(5, 3)) == 0
