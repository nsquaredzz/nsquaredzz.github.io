# escaping-flatland

Code and results behind the essay [Escaping Flatland](https://nsquaredzz.github.io/blog/escaping-flatland/): a "hyperbolic context manifold" written so that every operation is well defined, and two experiments that test what the essay claims for it.

Nothing here is a new method. The pieces are Poincare embeddings, hyperbolic graph networks, product manifolds and the Einstein midpoint, all cited in the essay. What this folder adds is one consistent construction, tests for each mathematical statement, and measurements.

## Layout

```
flatland/geom.py      Euclid, Poincare ball and product-of-disks (D^H): exp0, log0, distance,
                      Mobius addition, the corrected complex lift, the gyromidpoint
flatland/models.py    four message-passing networks of equal width: Euclidean GCN, Poincare ball
                      (HGCN style), product of disks, and a flat control with the disks' activation
flatland/data.py      WordNet mammals, Cora, Disease. Downloaded on first use, never committed
e1_hierarchy.py       experiment 1: how much hierarchy fits in n dimensions
e2_oversmoothing.py   experiment 2: does the geometry stop over-smoothing
e3_linkpred.py        experiment 3: lift + message passing + contrastive loss, link prediction on a tree
make_figures.py       every figure in the essay, from results/*.json and closed-form geometry
make_tables.py        every table in the essay, printed as markdown from results/*.json
export_comic.py       converts the essay's markdown into the React component of the comic-style blog
tests/                18 tests: each statement the essay makes about the geometry, and the networks
results/              e1.json, e2.json, e3.json, e1_embeddings.npz (the numbers the essay quotes)
```

## Run it

```bash
python3.12 -m venv .venv
.venv/bin/pip install torch numpy scipy nltk matplotlib pillow pytest
.venv/bin/python -m pytest tests -q          # 18 tests, a few seconds
.venv/bin/python e1_hierarchy.py             # about 30 minutes on a 10-core laptop
.venv/bin/python e2_oversmoothing.py         # about 25 minutes
.venv/bin/python e3_linkpred.py              # about 5 minutes
.venv/bin/python make_tables.py              # the essay's tables
.venv/bin/python make_figures.py             # writes ../../public/blog/escaping-flatland/*.webp
```

Everything runs on CPU, one thread per run, with the seeds fixed in the scripts. `--quick` runs a small version of any experiment in a minute or two.

## What is measured

**Experiment 1.** Reconstruction of the WordNet mammal hypernymy closure (1,170 synsets, 6,448 related pairs), the protocol of Nickel and Kiela (2017). Spaces at equal real dimension: Euclidean with distance and with squared distance, the Poincare ball, and a product of Poincare disks. Trained with a softmax over 10 sampled negatives on `-distance`, mini-batches of 2,048 pairs, 4,000 steps of Adam. Learning rate chosen per space and dimension from `{0.003, 0.01, 0.03, 0.1, 0.3}` on seed 0, then five seeds. Two checks at four times the budget. It also asks whether, in the product of disks, magnitude carries generality and phase carries branch.

**Experiment 2.** Part A repeats one neighbour-averaging step with no weights and compares the Euclidean mean with the gyromidpoint. Part B trains networks with 2 to 32 message-passing layers on Cora (public Planetoid split) and on the Disease tree (30/10/60 splits), with and without a skip connection to layer 0. One configuration per dataset, fixed in advance, identical for all models. 400 runs.

**Experiment 3.** Link prediction on the Disease tree (2,665 nodes, 11 features): 85/5/10 edge split, the contrastive loss on each space's distance, held-out pairs scored by negative distance. 1, 2 and 4 layers, five seeds, plus an uncapped run of the flat one-layer model to confirm it had converged.

## Results in one paragraph

Curved spaces hold far more hierarchy at low dimension (MAP 0.96 to 0.99 at 8 dimensions against 0.38 for Euclidean space, which reaches 1.00 at 32). Phase alone identifies a node's branch 99 % of the time; magnitude does not encode depth. The geometry does not stop over-smoothing: plain networks collapse by 32 layers in every space, and a skip connection fixes all of them. End to end on a tree, hyperbolic pipelines reach 0.94 to 0.99 AUC against 0.74 to 0.97 for flat ones. The product of disks never clearly beats the ordinary Poincare ball.

## Data and credit

WordNet 3.0 (Princeton), through NLTK. Cora with the Planetoid split, from the [planetoid](https://github.com/kimiyoung/planetoid) repository. Disease, from the [hgcn](https://github.com/HazyResearch/hgcn) repository of Chami et al. (2019).
