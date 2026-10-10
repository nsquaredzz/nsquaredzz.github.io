---
title: Certified skipping, part 2: the picture the model holds
subtitle: The certificate was about an image the model never has. One line changes that, and a sunset shows what it was costing.
date: 2026-10-11
tag: research
author: Niyath Nair
where: Bengaluru
summary: A follow-up to the certified patch-skipping note. The rule forgave a brightness shift per patch, so its guarantee was about a re-levelled image and not about the copy a model reusing tokens holds. Without that shift the guarantee covers the whole held frame. On a planted test the object reaches the held copy in 48 of 48 trials against 27; on real sunset footage the old rule leaves a quarter to a third of the picture stale and the new one under 1 %.
---

:::clips the change in two clips
![Real footage, nothing added: a sunset over Funchal, replayed at three times its speed. Top left: the camera. Bottom: the picture each rule leaves the model with, every patch as it was the last time it was sent. Green boxes are the patches sent just then; red marks pixels more than 20 grey levels from the camera. The old rule sends 1.5 % of the patches and ends with 54 % of the picture stale, a daytime sky over a night town. The new rule sends 2.5 % and never has more than 0.9 % stale. Footage: "Sunset timelapse in Funchal - 2014" by valunik, CC BY 3.0, Wikimedia Commons.](clip-sunset.mp4)

![The planted version of the same thing. A flat dark band, coloured orange for the viewer, fades in on the hallway floor. The old rule sends its edges and never its inside: 40 % of the band is missing from the model's picture. The new rule sends all of it, for 6.0 % of the patches against 5.4 %.](clip-band.mp4)
:::

:::note Where this fits
This continues [Certified patch skipping for fixed-camera video](/blog/certified-skip/). That note builds the rule and its certificates; this one is about a gap in what the certificate was a statement *about*, the one-line change that closes it, and what it costs. Code, proofs and every number are at [github.com/nsquaredzz/certified-skip](https://github.com/nsquaredzz/certified-skip): `THEORY.md` section 9 and `RESULTS.md` Part VIII.
:::

:::abstract
The skip rule of the first note removes a brightness offset from each patch before testing it. That is harmless inside one patch and it is what let the certificate ignore lighting flicker. Across patches it is not harmless: the certificate becomes a statement about the held copy *re-levelled patch by patch*, an image that exists only in the encoder. A model that reuses tokens holds the copy itself. Any change that is flat over whole patches, a shadow, a spill, a light going down, lives entirely in the offsets and is never sent.

Setting the offset to zero is a one-line change. The certificate then bounds the distance between the camera frame and the held copy over the whole frame, and the stability theorem applies to the frame and not to each patch separately. On the fade-in test of the first note, checked against the held copy, the planted object is present in 48 of 48 trials against 27, and the model reports it in 23 of 27 perceivable trials against 16. One of three cameras still favours the old rule. On three real sunset time-lapses, with nothing planted, the old rule leaves 24 to 33 % of the held picture wrong on average and the new one at most 1 %. The cost is about half a point of skip rate on indoor cameras and 0.6 to 2.3 points on the sunsets.
:::

## The gap

For a patch with held copy $R$ and new frame $F$, the rule of the first note computes the change $d = F - R$ and drops the patch while its *spread*, $\max d - \min d$, stays below a contrast level $\Delta$. Equivalently, it subtracts the midrange $c = \tfrac12(\max d + \min d)$ and bounds what is left:

$$\lVert d - c \rVert_\infty < \tfrac12 \Delta .$$

Inside one patch that subtraction changes nothing that matters. Adding a constant to a patch slides its persistence diagram along the diagonal and changes no contrast, so the certificate of the first note, *no feature of contrast $\Delta$ is born or dies in a skipped patch*, holds as stated.

The trouble is that $c$ is chosen separately for every patch. Over the frame the offsets form a field $c_p$, constant on each patch and different between patches, and what the rule bounds is

$$F - (R + c_p) \quad \text{on patch } p .$$

So the certificate is about $R + c_p$, the held copy re-levelled patch by patch. Nothing bounds $c_p$ itself, and no model holds $R + c_p$. A model that reuses its old tokens holds $R$.

Whatever lives in the field $c_p$ is therefore never sent:

- **A flat object on a flat surface**, once it covers whole patches. In its interior $d$ is constant, the spread is zero, and the patch is dropped at any threshold. Only the patches containing its edge are sent, so it arrives as an outline.
- **Any change of lighting.** On a flat patch, dimming changes $d$ by nearly a constant.

The overlays and clips of the first note, and its end-to-end test with a language model, all showed the re-levelled image. That is why this did not show up there.

## One line

Take $c = 0$. In its simplest form the score of a patch changes from

$$\max d - \min d \qquad\text{to}\qquad 2\,\lVert d \rVert_\infty .$$

The first asks whether the *pattern* in the patch changed. The second asks whether any pixel is far from what the model holds. In the multi-scale rule the same thing is done to the box averages. In the code it is `offset="none"` on the pruners, in C++ and in numpy; the per-patch offset remains the default, so every number of the first note is reproduced unchanged.

:::theorem Theorem 11 (certificate against the held copy, for the frame).
Let $V$ be the image equal to the held copy on every dropped patch and to $F$ on every sent one. Under the rule without offset, with thresholds $\varepsilon_r$ at box radius $r$:

1. $\lVert F - V \rVert_\infty < \varepsilon_0$ over the whole frame.
2. The persistence diagrams of the *frames* $F$ and $V$ are within $\varepsilon_0$ in bottleneck distance: no feature of contrast $2\varepsilon_0$ or more is born, dies, splits or merges anywhere, features that extend over many patches included.
3. On every $(2r+1)$-box inside a dropped patch, the mean of $F - V$ is below $\varepsilon_r$ in absolute value.
:::

:::proof
On a dropped patch the rule is the bound in 1; on a sent patch $F - V = 0$. A bound that holds on every patch with no constant depending on the patch holds on their union. Then 2 is stability applied to the frame, and 3 restates the rule.
:::

With the per-patch offset, statement 1 reads $\lVert F - (V + c_p) \rVert_\infty < \varepsilon_0$, which is true and is about the wrong image. The best statement that rule supports about $V$ has an extra term, half the oscillation of the offsets over the frame, and nothing bounds it.

At the schedule used in the benchmarks, $\Delta_r = 80\,(2r+1)^{-1/2}$ for $r \le 3$, this reads: no pixel of the held picture is more than 40 grey levels from the camera, and no 7×7 box is off by more than 15 on average. The rule also fits a sub-pixel shift per patch, as before, so strictly $V$ is the held copy moved by less than a pixel.

Neither failure is new to vision. Lighting changes and the unseen interior of a uniform object are the "light switch" and the "foreground aperture" of the background-maintenance literature [1]. What is added here is the observation that the *certificate* was stated up to a constant per patch that no consumer holds, and what the stability theorem gives once that constant is gone.

## The planted test, against the held copy

The fade-in experiment of the first note plants a square that appears slowly over several seconds and asks Qwen2-VL-2B [2] whether it is there. This repeats it on the copy the model would hold, for the rule as published and for the rule without offset: three cameras, 16 trials each.

:::tbl **Table 1.** The fade-in test on held copies. *In the copy*: the square's pixels in the held copy differ from the scene without it by more than half its contrast, on average. *Model says yes*: over the trials where the model reports the square in the full frame.
| camera | trials | model sees it in the full frame | in the copy: heuristic / published / no offset | model says yes: heuristic / published / no offset |
|---|---|---|---|---|
| hallway | 16 | 8 | 2 / 13 / 16 | 1 / 3 / 8 |
| lobby | 16 | 12 | 4 / 14 / 16 | 0 / 12 / 10 |
| parking lot | 16 | 7 | 0 / 0 / 16 | 0 / 1 / 5 |
| all | 48 | 27 | 6 / 27 / 48 | 1 / 16 / 23 |
:::

Without the offset the square is in the held copy in all 48 trials. On the parking lot, where the square covers many whole patches, the published rule's copy has it in none.

The model follows on two cameras and not on the third. On the lobby the published rule scores 12 of 12 and the rule without offset 10 of 12, although the square is in the copy in all 16 trials there. I do not have an explanation for those two misses. It is one run of a 2B model.

## Real footage

A planted square is a stand-in. The first eight untouched clips I tried, people walking through hallways and car parks, contain almost no change of this kind: the old rule held a patch at the wrong brightness in a few hundred patch-frames per clip and the new rule in none, but never more than four patches at once, which nobody would see.

Footage that does contain it is easy to name: a camera left running while the light changes. Three sunset time-lapses from Wikimedia Commons, fixed cameras, nothing added:

:::tbl **Table 2.** Real sunset time-lapses, both rules at the benchmark schedule. *Stale*: pixels of the held picture more than 20 grey levels from the camera frame, averaged over the clip. Funchal at 704×400, the other two at 480×272.
| clip | frames | patches sent: published / no offset | stale, mean: published / no offset | stale, worst frame: published / no offset |
|---|---|---|---|---|
| Funchal | 1589 | 1.5 % / 2.5 % | 27.5 % / 0.6 % | 55.0 % / 0.9 % |
| Munich, nightfall | 2010 | 4.8 % / 5.3 % | 32.5 % / 0.7 % | 47.2 % / 12.2 % |
| Tokyo | 901 | 3.4 % / 5.7 % | 23.7 % / 1.0 % | 47.5 % / 2.3 % |
:::

The first clip above is the Funchal row. The published rule keeps refreshing the streets, where headlights move, and leaves the sky where it was in the afternoon. By the end the model holds a night town under a daytime sky.

These are time-lapses: hours in under a minute. The change per frame is still gradual, which is the case that matters, but it is faster than a real-time camera would see, and a real-time camera is where "slow" is slowest. The numbers of Table 2 are in `RESULTS.md` Part VIII, with the command that prints them.

## What it costs

The rule without offset sends more, because it now sends lighting.

- On the three indoor and car-park cameras of Table 1, the share of patches skipped goes from 94.9 to 94.4 %, 97.9 to 97.4 % and 99.6 to 99.5 %.
- On the sunsets it sends 0.6 to 2.3 points more, and on Funchal that is two-thirds more patches than the published rule.
- A change of level over the whole frame, a light switch, resends the frame. That is the truth being sent. For a camera whose gain hunts by a few grey levels it would be waste; one bounded level per *frame*, not per patch, could be divided out at no cost to a model that ignores global brightness. A prototype of that made no measurable difference on six clips, so it is not in the code.

## What else is in the repository since the first note

Two further results, written up in `THEORY.md` and `RESULTS.md` and not argued here:

- **Frame rate.** At the same skip rate, a consecutive-frame heuristic leaves more wrong pixels the faster the camera runs, a median of 11.6 times the certified rule's at 25 to 30 fps on 11 clips, while the certified rule does not change (section 10, Part IX).
- **The fewest sends a certificate allows.** A lower bound on the patches any method must send for a given guarantee, and a rule that looks a few frames ahead and holds the centre of what is coming: about half the sends of holding the current frame at 8 frames of look-ahead (sections 11 and 12, Part X).

## What is still open

- The lobby camera in Table 1.
- Real-time footage with a slow lighting change. The standard sequences for it, Wallflower's "time of day" and "light switch" [1], were not downloadable when I looked.
- Token reuse inside the model. Every model result here shows the model a picture; none reuses its tokens.
- Which rule should be the default.

## References

1. K. Toyama, J. Krumm, B. Brumitt, B. Meyers. Wallflower: principles and practice of background maintenance. *ICCV*, 1999.
2. P. Wang et al. Qwen2-VL: enhancing vision-language model's perception of the world at any resolution. 2024.
3. D. Cohen-Steiner, H. Edelsbrunner, J. Harer. Stability of persistence diagrams. *Discrete & Computational Geometry* 37, 2007.

**Footage.** "Sunset timelapse in Funchal - 2014" by valunik, CC BY 3.0; "Nightfall timelapse from Olympiaturm" by Slashme, CC BY-SA 4.0; "Sunset tokyoarea-timelapse-2019-03-17" by Nesnad, CC BY-SA 4.0; all from Wikimedia Commons. Xiph.org derf test collection (hall_monitor). VIRAT Video Dataset, public release, Kitware. CAVIAR test case scenarios, EC project IST 2001 37540.
