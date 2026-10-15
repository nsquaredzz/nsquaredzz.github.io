---
title: Two days of negative results on tracking
subtitle: A pixel certificate wrapped around a learned point tracker changed nothing; a conformal test for identity switches in crowds detected the wrong thing. The numbers, the reasons, and what is kept.
date: 2026-10-15
tag: research
author: Niyath Nair
where: Bengaluru
summary: Two attempts to add something provable to tracking, each killed by criteria written before the runs. First, the patch certificate of the earlier notes applied per step to point tracks: precise when it fires (97 to 100 percent within 4 px) but sparse (one visible frame in ten), and wrapped around CoTracker3 it reproduces the model to the decimal, because the model is anchored to the same query frame in a space that forgives more. Second, a conformal test martingale on a tracked person's appearance as an identity-switch detector in crowds: valid on exchangeable streams, but after an occlusion a person's own appearance is an outlier to their history on about half of real episodes, so it detects appearance change, not identity change. What survives is small and stated.
---

:::clips one clip from each day
![Day one. The car-shadow clip of DAVIS replayed as a 500-frame palindrome at 256 by 256. Middle: every tracked point, white ring for the ground truth, amber where CoTracker3 holds the point, green where the step is certified against the point's query-frame template. Right: error against the ground truth over time. The green steps sit exactly where the amber ones were.](clip-car-shadow.mp4)

![Day two. A MOT20 crowd, one person tracked by SAM 2.1 through a 22-frame occlusion: white box the ground truth, green mask on the right person throughout. Below, the martingale's wealth on a log scale against the lines for alpha 0.1, 0.05 and 0.01: it climbs through the occlusion and keeps climbing after it, on a person who never changed. Footage: MOT20-01, MOTChallenge, CC BY-NC-SA 3.0.](clip-crowd-recovered.mp4)
:::

:::note Where this fits
This follows [Certified patch skipping for fixed-camera video](/blog/certified-skip/) and [part 2](/blog/certified-skip-held-copy/). Those notes certify what cannot have changed inside a skipped patch. Here the same habit, a theorem with a threshold and a measured negative, is applied twice to tracking and comes back empty twice. Code, every number and the proof videos are at [github.com/nsquaredzz/certified-track](https://github.com/nsquaredzz/certified-track) and [github.com/nsquaredzz/crowd-target](https://github.com/nsquaredzz/crowd-target).
:::

:::abstract
Day one asked whether a raw-pixel certificate can carry a point track, or at least help a learned tracker. Each query point keeps the template of its query frame; on every later frame the template is found at an integer position and the match is certified by the multi-scale box test of the first note, with one change the test should always have had: the exact brightness offset, which the midrange is not. On six clips of TAP-Vid DAVIS the certificate is precise and sparse: with a 21-pixel template it fires on 10 to 12 percent of visible frames, 1 to 4 percent past thirty frames from the query, and 93 to 100 percent of certified steps are within 4 px of the truth. The search is not the limit; certifying at the ground-truth position gives the same share. Wrapped around CoTracker3 as a verifier it reproduces the model to the decimal, on short clips and on 500-frame replays where the model does not drift: it never fired where the model was wrong.

Day two asked whether a tracker can be told, with a guarantee, that it has switched person in a crowd. The tool was a conformal test martingale on the tracked person's appearance: online conformal p-values against the person's own earlier frames, a betting martingale, and Ville's inequality for a time-uniform false-alarm bound. The mathematics checks out on simulated streams. On 24 occlusion episodes mined from MOT20, measured on ground-truth crops with no tracker involved, 45 to 96 percent of the same person's post-gap crops fall outside the whole pre-gap pool, depending on the embedding and how much history the pool holds. Their new appearance is an outlier to their own past; a p-value against that past is tiny whatever the identity. The detector detects appearance change, and alarms on half the episodes in which the tracker recovers the right person.

Both attempts were killed by criteria written before the runs. What is kept: the exact offset for the multi-scale test, the self-match set of a template as the object that bounds position under a certificate, a census showing how rare clean occlusions are in MOT20, and across-gap separability tables for two training-free embeddings.
:::

## Day one: a certificate per step

The step is Lucas-Kanade with the first-frame check of Shi and Tomasi (1994) and the template-update rule of Matthews, Ishikawa and Baker (2004), which re-aligns to the first template and rejects drift past a threshold. What was added is that the threshold has a theorem: the crop at the matched integer position and the template are both arrays of actual pixels, so the stability theorem of the first note applies with nothing interpolated, and a certified step says that no feature of contrast $\Delta_r$ containing a $(2r+1)$-box appeared, vanished, split or merged in the template's footprint, up to one brightness offset.

That offset matters more than it looks. The range rule subtracts the midrange of the residual. For the multi-scale test the right constant is the one that minimises the score, a maximum of $2|R|$ lines in $c$, and it has a closed form from the largest and smallest box means at each radius. On the first frame after the query on car-shadow, 4 percent of templates certified with the midrange and 56 percent with the exact offset.

:::tbl **Table 1.** The certify-only tracker on six DAVIS clips at 256 by 256, over counted frames whose ground truth is visible. *S = {0}*: templates that certify against themselves at no shift of two pixels or more, the self-match set, which Theorem P below makes the object that bounds position.
| template | $\Delta_0$ | fit | certified | past gap 30 | within 4 px | within 4 px, S = {0} | certified while occluded |
|---|---|---|---|---|---|---|---|
| 21 px | 80 | translation | 11.0 % | 1.8 % | 94.1 % | 100 % | 0.0 % |
| 21 px | 96 | affine | 16.1 % | 7.4 % | 88.4 % | 100 % | 4.7 % |
| 21 px | 128 | affine | 22.9 % | 17.3 % | 81.5 % | 86.7 % | 13.3 % |
| 13 px | 128 | translation | 44.1 % | 39.9 % | 55.2 % | 89.5 % | 19.2 % |
:::

The one statement about position is elementary and old in spirit. Let $S$ be the set of integer shifts at which the query window certifies against itself. If the new frame is the query window shifted by $u^*$ up to noise of score at most $\eta$, a certified step at $k_t$ has $k_t - u^* \in S(\eta)$; a corner gives $S = \{0\}$, an edge a segment, periodic texture a lattice. This is the uniqueness idea of Moravec's interest operator (1980), the peak-to-sidelobe ratio of MOSSE (2010) and Lowe's ratio test (2004), stated as a set and measured: certified steps on templates with $S = \{0\}$ are within 4 px of the truth 97 to 100 percent of the time, the others 40 to 65.

Beside CoTracker3, with the certified position reported only when the two disagree and the template is unique, the hybrid gives the model's numbers exactly: AJ 71.9, $\delta_{\mathrm{avg}}$ 85.1, OA 91.5 on the clips; AJ 60.5, survival 96.1 percent on 500-frame replays. The certificate fired on 5 to 12 percent of frames, was within 4 px every time, and never on a frame where the model was wrong. CoTracker3 carries the feature of its query frame and matches it with learned correlation; it is anchored where the template is, in a space that forgives deformation, blur and lighting. A raw-pixel template modulo a warp and an offset forgives less and fails first. There is no frame on this footage where the certificate knows something the model does not.

## Day two: a guarantee that the tracker switched person

Tracking one person through a crowd works today (SAM 2 with a click, or any MOT tracker with re-identification) and fails in one known way: identity switches after long occlusions and among look-alikes. The memory variants of SAM 2 (SAM2Long, DAM4SAM, SAMURAI, SENTRY) and the classical machinery (DeepSORT's cascade, Possegger's occlusion geodesics, multiple-hypothesis tracking) all exist, so the plan was not to build another combination of them but one small piece with a guarantee: a detector of the switch itself.

The piece is Vovk's conformal test martingale (2003; Vovk et al. 2021 for change detection), which no tracker uses. A tracked person gives a stream of nonconformity scores, the distance of the current mask's appearance embedding to the person's own earlier frames. Online conformal p-values against a pool that grows with every tested score are independent and uniform if the stream is exchangeable; a test martingale $W_t = \prod_u b(p_u)$ with $\int_0^1 b = 1$ has expectation one under that null, and Ville's inequality gives $P(\sup_t W_t \ge 1/\alpha) \le \alpha$. The alarm $W_t \ge 1/\alpha$ is a time-uniform test, with no training and no noise model. On simulated streams the implementation does what the theorem says: uniform p-values, false-alarm rate under $\alpha$ over 2,000 streams, a shift of 2.5 standard deviations caught in a median of under 25 steps.

The kill criterion, written first: a false-alarm rate above $2\alpha$ on episodes where the tracker recovers the right person. It could be tested without running the tracker at all. From MOT20 train, 120 single-target episodes were mined by fixed rules (an occlusion of 20 to 200 frames, a half-visible run before and after, a box at least 40 pixels tall; 2,064 raw gaps shrink to this because people in these crowds are partly occluded most of the time), and on 24 of them the person's own ground-truth crops before the gap formed the pool while their crops after the gap were scored against it.

:::tbl **Table 2.** Across-gap separability on 24 MOT20 episodes, ground-truth crops. *Above pool*: share of the same person's post-gap crops scoring above every score in the pre-gap pool; a conformal p-value there is about $1/(n+1)$ whatever the identity. *AUC*: same person across the gap closer than another person in the same frame.
| embedding | pool | above pool | AUC, pooled | AUC, median per episode |
|---|---|---|---|---|
| Faster R-CNN box head | 30 pre-gap frames | 96 % | 0.69 | 0.69 |
| Faster R-CNN box head | 300 frames of history | 61 % | 0.68 | 0.74 |
| DINOv2 ViT-S/14 | 30 pre-gap frames | 89 % | 0.75 | 0.81 |
| DINOv2 ViT-S/14 | 300 frames of history | 45 % | 0.71 | 0.81 |
:::

Without a gap the box-head feature separates identities at AUC 0.90. Across a gap, per episode, the share above the pool is bimodal: zero on ten episodes, 90 to 100 percent on nine. On those nine the person turned, walked into other light, or came back with a different part of them visible. Their new appearance is an outlier to their own history, and no test on that history can tell it from a stranger.

The tracked stream said the same. SAM 2.1 alone was run on 16 of the episodes (the long-gap bin was not run once the crops had settled it): 13 recovered, 2 switched, 1 lost; the failure the piece was built for is rare here, and one of the two switches began inside the occlusion, a drift onto the occluder, where a detector at re-emergence cannot act. On that stream, gated to frames where SAM 2 claims a whole person, the martingales alarmed on 13 of 13 recovered episodes at every $\alpha$; the one setting that stayed quiet, the simple jumper on every twelfth frame, detected neither switch. A detector of exchangeability on an appearance stream detects appearance change; after a long occlusion that is the normal case, not the failure.

## What is kept

- The exact brightness offset for the multi-scale box test, a closed form the midrange does not approximate on real patches.
- The self-match set as the object that turns "the template is present" into "the template is here", with its hypotheses stated and its precision measured.
- A census: under rules that demand a half-visible run before and after a full occlusion, MOT20 train yields 8 episodes with strict thresholds and 120 with loose ones, out of two thousand raw gaps. Clean occlusions are rare in dense crowds; the usual state is partial.
- Across-gap separability for two training-free embeddings, with the per-episode bimodality. Anyone building re-association on appearance in crowds is working on the half of episodes where the appearance did not change.
- Two kill criteria that did their job on the day they were written.

What is not kept is any tracking claim. Both ideas were elementary applications of known mathematics, which the write-ups say; what they would have contributed was a measurement, and the measurement came out the other way.
