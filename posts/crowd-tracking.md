---
title: Holding one person through a crowd
subtitle: In a dense crowd the hidden person is rarely invisible. On the episodes it was built from, a filter on SAM 2's memory trades its wrong-person endings for losses; looking back from the future picks the right person when it is handed the right candidates. What was measured, how little it proves, and what is still open.
date: 2026-10-15
revised: 2026-10-15
tag: research
author: Niyath Nair
where: Bengaluru
summary: A third pass at keeping one designated person through a crowd, on top of a frozen SAM 2.1. Measured on 120 MOT20 occlusions with ground truth only, a person who is "occluded" still shows 100 pixels or more on 88 percent of those frames; the problem is holding a sliver, not re-identifying someone who vanished. Of every clue tried, knowing who stood in plain view the whole time rules out the most impostors (61 percent); colour rules out 36 percent and never picks; height and walking reach rule out about one in ten. A filter that refuses some of SAM 2's frames ends on the wrong person 0 times in 16 development episodes against 2 for SAM 2.1 alone, recovers the same 13 and loses one more: a switch traded for a loss, on the episodes the rules were built from, with 95 percent intervals that overlap. The logs say the one switch it prevented was stopped by its simplest checks, mask size and walking reach, not by the neighbour or colour machinery. Following every candidate backward in time picked the right person 9 times in 13 and the wrong one never, with candidates taken from the ground truth. None of this has been checked on held-out footage.
---

:::clips two episodes, three trackers each
![MOT20-05, person 611, hidden for two seconds behind a group. Left: SAM 2.1 alone. Middle: SAM 2.1 with SAMURAI's motion-aware memory, a published fix. Right: our tracker. The white box is the true person; a mask is green on the right person, red on someone else, amber when the tracker outputs nothing. On this episode the first two slide onto a neighbour at frame 2443 and stay there; ours refuses frame 2442 (the mask has shrunk to half its usual size) and frame 2443 (outside walking reach) and stays on the person. One episode, from the set the rules were built on. Footage: MOT20, MOTChallenge, CC BY-NC-SA 3.0.](clip-611.mp4)

![MOT20-05, person 480, about 60 pixels tall at the top edge of the frame, zoomed. Left: SAM 2.1 alone, which ends on the person beside them (482). Middle: our forward tracker, which refuses the wrong person and loses the right one. Right: hindsight, which follows everyone visible 15 frames after the occlusion backward in time and keeps the one whose path meets the person where they were last seen for certain. The candidates in this episode come from the ground truth, and the choosing rule was written after the first test episode; see below.](clip-480.mp4)
:::

:::note Where this fits
This follows [Two days of negative results on tracking](/blog/certified-tracking/). Same footage (MOT20 train, 120 single-target occlusion episodes mined by fixed rules), same frozen SAM 2.1 base+, same Mac. Code and every number are at [github.com/nsquaredzz/crowd-target](https://github.com/nsquaredzz/crowd-target), RESULTS.md Parts IV to VIII.
:::

:::abstract
Tracking one person through a crowd works today and fails one way: after an occlusion the tracker ends on someone else and says nothing. This note asks where that failure comes from and what can be done about it without training anything.

It starts with measurements, not a method. With ground truth only, on 120 occlusion episodes from MOT20, a person whose box visibility is under 0.3 still shows 100 pixels or more on 88 percent of those frames, and 92 of the 120 never go more than five frames without showing that much. Of the people within walking reach when the hidden person reappears, knowing who stood in plain view the whole time rules out 61 percent; a one-sided colour test, built so that any partial view of the person passes it, rules out 36 percent; height and walking reach rule out about one in ten each.

Then two trackers built on those measurements. The first refuses SAM 2's frames when the mask shrinks to half its usual size, lands on a known neighbour, shows colours the person never wore, or, while the person is lost, falls outside walking reach, and keeps those frames out of SAM 2's memory. On 16 development episodes it ends on the wrong person 0 times against SAM 2.1's 2, recovers the same 13, and loses 2 where SAM 2.1 lost 1. That is a switch traded for a loss, and the 95 percent intervals on the switch rate overlap (0 to 21 percent against 2 to 38 percent). The logs say the one switch it prevented was stopped by the size and reach checks; the neighbour veto and the colour budget did not fire at that moment, and no ablation has been run. The second looks back: it follows every candidate backward from after the occlusion and keeps the one whose path meets the person's last certain position. On 13 episodes, with candidates taken from the ground truth, which is its best case, it chose right 9 times under the rule written before the run and wrong never.

The rules were designed while looking at these episodes, and the held-out run was stopped after 8 of 96 episodes of the baseline. Nothing here is a benchmark result; the strongest sentences in this note describe hypotheses.
:::

## A hidden person is rarely invisible

MOT20's annotation gives every person a box even when they are behind others, and a visibility between 0 and 1. The episodes are runs of 20 to 200 frames where the target's visibility stays under 0.3, bracketed by half-visible frames. On each of those frames, the part of the person that still shows can be measured without any tracker: the pixels inside the person's box that lie in no nearer person's box and differ from the static background.

![On 88 % of occluded frames at least 100 pixels of the person still show; 81 of 120 episodes never have a single frame with less.](hidden.webp)

The median occluded frame shows 772 pixels of the person, about a sixth of a body. The head region is less than half covered on 79 percent of occluded frames. The longest true blackout is 0 frames in the median episode and 20 frames at the 90th percentile. In this footage, holding on to a sliver is the problem far more often than finding someone again after they vanished.

That changes what a tracker should be good at. SAM 2's memory works well while the person is fully visible, and its failures start when the visible part shrinks and a neighbour's pixels look like a better match.

## What each clue rules out

The question before building anything: at the frame the hidden person reappears, of the people within walking reach, how many can each clue rule out, and how often does it wrongly rule out the right one? Ground truth only, 1,746 people within reach over the 120 episodes, thresholds set by split conformal calibration at 5 percent per clue on half the episodes and tested on the other half.

![Being seen the whole time rules out the most and never the right person; colour, height and reach do much less.](clues.webp)

- *Seen the whole time.* A person who was in plain view on most of the occluded frames is not the one who was hidden. This rules out 61 percent, and never the right person.
- *Colour.* The person's colour is kept as a budget: for every colour, the most of it the person ever showed before the occlusion, per unit of body height squared, after correcting for global light changes measured on the static background. A later view that is part of the same person cannot exceed the budget, whatever part of them shows; a candidate who shows a colour the person never showed is ruled out. This is one-sided by design: a missing colour is never evidence, so a partial view always passes. It rules out 36 percent and wrongly rules out the true person in 8 of 120 episodes, mostly outdoors, where shadows break the light correction.
- *Height.* From a fixed elevated camera, a person's pixel height divided by the scene's height at that image row is constant with depth. It rules out 11 percent: people are about the same height.
- *Walking reach.* The set of places the hidden person could be, propagated frame by frame through the other people's boxes at walking speed. In a crowd this dense it covers almost every candidate and rules out 10 percent.

Combined, they leave a median of three people in the set at 82 percent coverage, and a single correct person in 21 percent of episodes. Two people in the same clothes, of the same height, hidden behind the same group, are the case none of these can split.

## A veto on SAM 2's memory

Watching SAM 2.1 fail on the development episodes made the mechanism plain. Person 611 is hidden behind a group for two seconds. At frame 2443 the mask covers mostly a neighbour; SAM 2 writes that frame into its memory, and from then on it is tracking the neighbour with full confidence. Its own object score never drops below 1.8. SAMURAI, which adds a Kalman filter to the choice of mask and to which frames enter memory, does the same thing on this episode a few frames later: the neighbour walks exactly where the filter predicts the person to be. SAMURAI was run on only 4 development episodes and ended on the wrong person in 3, against SAM 2.1's 2 on the same 4; that is too few to say anything general about it.

The tracker built here keeps SAM 2.1 as the engine and adds one decision per frame: does this mask enter memory? It does not if it coincides with a detection of a known neighbour (anyone who stood beside the person while they were tracked and has been seen continuously since), if it shows colours outside the person's budget, if it is less than half the person's usual size, or, while the person is lost, if it is outside walking reach. A refused frame is removed from memory. While lost, the tracker re-prompts SAM 2 on a single admissible detection, keeps the result provisional for five frames, and withdraws it if it fails. With two or more admissible candidates it says so and outputs nothing.

![Over 16 development episodes, the wrong-person endings go from 2 to 0, the recoveries stay at 13, and the cost is one more lost episode and one "one of these".](outcomes-dev.webp)

:::tbl **Table 1.** The 16 development episodes, hidden 21 to 70 frames. Detections from YOLO11x (COCO weights) at 1920 pixels. Intervals are exact (Clopper-Pearson) 95 percent intervals on the share of episodes ending on the wrong person; an exact paired test on the two episodes where only one tracker switched gives p = 0.5.
| | recovered | on the wrong person | 95 % interval | lost | "one of these", true person in the set |
|---|---|---|---|---|---|
| SAM 2.1 base+ alone | 13 | 2 | 2 – 38 % | 1 | – |
| our tracker | 13 | 0 | 0 – 21 % | 2 | 1 |
:::

Per episode: 611 is recovered, the switch shown at the top of the note. 480, the second switch, becomes a loss: the tracker refuses the wrong person and never finds the right one, who is a 60-pixel figure at the frame edge that no detector sees. 505, at night, which SAM 2.1 loses, becomes a set that contains the right person on every frame after the occlusion. And 169, which SAM 2.1 recovers, is lost: at night a false detection inside walking reach passed the colour test, because in the dark everything falls into the same bin.

Four episodes changed outcome, two for the better (611 recovered, 505 a set instead of a loss) and two for the worse (480 and 169 lost). On recoveries the two trackers are level.

Which check did the work is a question the design invites and the experiment did not answer. The logs answer part of it. On 611 the frame SAM 2 slid on (2443) was refused because the mask was outside walking reach, and the frame before it (2442) because the mask had shrunk to half the person's usual size; neither the known-neighbour veto nor the colour budget fired. On 480, SAM 2's first frame on the wrong person passed every check, and the size check refused the next two. So the one switch prevented here was prevented by the two simplest rules. That is attribution from logs, not an ablation: refusing a frame changes what SAM 2 remembers afterwards, so the counterfactual needs a rerun with one check at a time, which has not been done.

These are the episodes the rules were designed on. Two changes were made after seeing failures in them and are recorded as such. A held-out run of 96 episodes was started; SAM 2.1 alone finished 8 of them (6 recovered, 2 on the wrong person, both during the occlusion) before the compute was stopped, and our tracker did not run.

## Looking back from the future

Every identity in MOT20, through every occlusion, was assigned by a human annotator who could watch the clip forward and back. That annotator does something no forward tracker does: looks at who is there after the occlusion and follows them backward to see whose path meets the person where they were last seen for certain.

Hindsight does exactly that with SAM 2.1. When the forward tracker loses firm hold, the last firm frame is the anchor. Fifteen frames after the person reappears, every candidate is prompted as its own object and tracked backward, jointly, to the anchor. The identity goes to the candidate whose backward mask overlaps the forward mask over the last eleven firm frames. A clear winner is required; otherwise the answer is the set, or nothing.

![With candidates from the ground truth, on every episode where any backward path reached the person's last certain position, it was the true person's.](hindsight.webp)

:::tbl **Table 2.** Hindsight on the 13 development episodes where the forward tracker lost firm hold. Eight candidates per episode: the person and the seven people nearest them, taken from the ground truth.
| rule | right person | wrong person | no choice |
|---|---|---|---|
| written before the run: overlap at least 0.5, runner-up under 0.25 | 9 | 0 | 4 |
| written after the first episode: best at least 0.1 and three times the runner-up | 11 | 0 | 2 |
:::

Against the criterion written before the run (at least 10 of 13), it failed by one. No wrong choice under either rule, which with 13 episodes still allows a wrong-choice rate of up to 25 percent at 95 percent confidence: impostors scored between 0.00 and 0.07 except on one episode, where the true person scored 0.23 and the best other 0.19 and the rule abstained. It recovers 169, which the forward tracker lost, and identifies 480, the frame-edge case, as the only candidate whose backward path reaches the person. At night (505) no backward path reaches anyone.

Two things keep this from being a tracker. The candidates came from the ground truth: with a detector, 12 to 47 people are within reach at the end of a clip, and the true person is often not among the nearest. And a reverse pass costs about 0.45 seconds per candidate per frame on the Mac, five to ten minutes per episode with eight candidates.

## What did not work

- *Colour as an identifier.* The budget is sound and weak: MOT20 is dark coats, and the test can only exclude.
- *Certified texture chains on the visible sliver.* The raw-pixel certificate of the earlier notes, applied to 21-pixel patches on the visible part of the hidden person, never certified on the nearest neighbour (0 of 1,288 tries), but a sliver thinner than 21 pixels holds no patch: the chains joined a median of 0 percent of occluded frames, or 59 percent with a 10 percent false rate when patches were allowed at the sliver's edge. In the tracker, a weak chain once vouched for a mask that had slid onto a neighbour. Closed.
- *A switch alarm.* The conformal martingale of the previous note, rerun with the colour budget in place of a learned embedding: false alarms on recovered episodes fell from 13 in 13 to 5 in 13, and it detected neither switch, because both impostors wore the person's palette.
- *Confirming by rare features.* Patches and colours the person showed and the surrounding crowd did not: 13 right and 1 wrong when exactly one candidate had one, but a surrounding crowd of 25 to 50 people is too few to put a bound on how often a stranger would.

## What to doubt

These points came from a reader after the first version of this note, and each is right.

- *The sample is tiny.* Two wrong-person endings against none, on 16 episodes, is within noise; with recoveries level and one more loss, the data say the filter trades a switch for a loss, not that it helps.
- *The rules were tuned on the test episodes.* Every headline number in the tracker sections is about the 16 episodes the rules were built on. Until the held-out run finishes, they describe a hypothesis.
- *Hindsight was given its best case.* With a detector there are 12 to 47 people within reach and the true person is often not among the nearest, so 9 or 11 of 13 says nothing about the method end to end, which also costs five to ten minutes an episode.
- *There is no ablation.* The filter has four refusal conditions; the logs point at the two simplest for the one switch it prevented, which suggests the colour budget adds complexity for little in the tracker. Only one-check-at-a-time reruns can settle it.
- *The SAMURAI comparison is one clip.* A claim that SAMURAI also switches needs both baselines on the same 16, and later 96, episodes.

## What is new, what is not

Not new: SAM 2.1 and its memory; SAMURAI and DAM4SAM's memory rules, re-implemented here for comparison; colour histograms and the diagonal illumination model; reachable sets through occluders (Possegger et al. 2014); forward-backward consistency as a tracking check (Kalal et al. 2010); split conformal calibration; height as a soft biometric; detectors.

New, to the best of my reading: the measurement that a MOT20 occlusion is mostly a partial one; the clue-by-clue table of what rules out how many people within reach; the colour budget as a one-sided, illumination-certified test that no partial view of the person can fail; a filter on what SAM 2 remembers (whose neighbour and colour checks, the logs say, did not fire at the one switch it prevented); and identity after an occlusion decided by where jointly back-tracked candidates meet the trusted forward track, with abstention. Each is a small piece, and each is reported with the run that tested it.

## What is still open

The claim this work would like to make is that refusing frames stops silent identity switches without costing recoveries. On the episodes it was built from it traded a switch for a loss, and the switch it stopped was stopped by its simplest checks. The 96 held-out episodes, run with SAM 2.1, SAMURAI and the filter side by side, plus one-check-at-a-time reruns, are what would turn that into a result; until then it is a hypothesis with a mechanism and one clear video. Hindsight needs candidate generation that keeps the true person on the list, and a cheaper backward pass. And two people in the same clothes hidden behind the same group remain, as they must for anything that only has pixels, a set of two until they step apart.
