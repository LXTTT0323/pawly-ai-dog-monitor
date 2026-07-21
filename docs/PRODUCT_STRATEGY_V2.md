# Pawly product strategy v0.2

Date: 2026-07-21  
Status: local product branch; do not deploy while the current production room is in use

## Executive decision

Pawly should not behave like a rigid course that asks every owner to leave for 5 minutes, then 10 minutes, then 15 minutes. Most owners have two real needs:

1. **Quick check:** run a short 10–30 minute baseline when they are learning how the puppy responds.
2. **Going out:** monitor a normal 30-minute to 4-hour absence and be told only when something meaningful changes.

The product entry remains immediate utility:

> Turn any spare phone, tablet, or computer into a private pet camera.

The retained product value is longitudinal understanding:

> Pawly shows when your puppy was calm, when meaningful activity began, whether the puppy settled again, and how this compares with similar outings.

The camera gets the user started. The behavior history and useful alerts make the product worth keeping.

## Product narrative

### Consumer-facing

> Turn a spare device into an AI puppy camera that understands the moments that matter.

Supporting promise:

> Watch live when you want. Pawly quietly observes the rest, and summarizes how your puppy spent the time alone.

### Investor-facing

> Pawly is building a longitudinal behavior layer for pet care, beginning with privacy-first monitoring on hardware owners already have.

### What not to claim

- Do not claim to diagnose separation anxiety, panic, fear, or health conditions.
- Do not call every movement a behavior.
- Do not promise that a longer session is safer because the previous session looked calm.
- Do not market continuous cloud AI or 24/7 emergency coverage.

## Two product modes

### Quick check

Use when an owner is establishing a baseline or testing a new room, crate setup, or routine.

- Presets: 10, 15, 20, and 30 minutes.
- The result describes time to first meaningful activity, longest calm span, recovery, visibility, and camera quality.
- Suggestions use meaningful checkpoints such as 15, 20, 30, 45, or 60 minutes. They never add one minute at a time.
- A result is evidence for comparison, not permission to leave longer.

### Going out

Use for normal life.

- Presets: 30 minutes, 1 hour, 2 hours, 3 hours, and 4 hours.
- Default: 3 hours.
- The owner can watch live at any time, but should not need to keep the dashboard open.
- Pawly groups ordinary motion and reports sustained changes, recovery, vocal candidates, loss of view, and camera failure.
- The review compares the outing with another outing of similar duration and time of day. It does not prescribe a shorter or longer absence from motion alone.

## The core observation loop

```text
Start a quick check or normal outing
→ run inexpensive local sensing continuously
→ wake dog/audio models only when useful
→ group raw signals into sustained episodes
→ notify only for an actionable or unusual episode
→ summarize the outing
→ compare with the dog's own baseline
```

## Useful measures

Prioritize measures that can be observed without guessing emotion:

- camera uptime;
- dog visible percentage;
- time to first sustained activity;
- longest low-motion span;
- number and duration of active episodes;
- time taken to return to a low-motion state;
- repeated path candidate;
- bark/whine candidate count and duration;
- changes relative to a similar past outing.

Do not surface a single universal “calm score” until it is validated. A transparent timeline is more trustworthy.

## Notification policy

The default should be quiet.

Immediate notifications:

- camera stopped or page was suspended;
- dog has been out of view beyond a configurable period;
- sustained vocal or repetitive-movement candidate;
- a major change from this dog's recent baseline.

Digest-only observations:

- ordinary movement;
- one short active episode;
- moving between bed, floor, and door;
- isolated sound or uncertain detection.

## Business and retention hypothesis

Free utility:

- one camera;
- live view;
- camera health;
- basic motion timeline;
- short local history.

Paid value:

- dog-specific detection;
- meaningful behavior episodes;
- longer history and comparison by outing;
- useful notifications;
- event clips when explicitly enabled;
- household and trainer sharing.

The strongest retention metric is not minutes of live video watched. It is the percentage of monitored outings that users review, and whether they return to compare another outing within seven days.

## Near-term validation

1. Use Pawly for five real outings with the founder's dog: one quick check and four normal absences.
2. Manually label dog visible, low motion, active movement, repetitive path, and vocal candidates.
3. Measure camera uptime, battery drain per hour, false alerts, and missed meaningful episodes.
4. Ask ten puppy owners whether the outing review changed what they did next.
5. Only then tune or train a dog-specific temporal model.

## Build sequence

1. Ship the two realistic modes and non-linear summaries locally.
2. Benchmark battery and stream reliability for a 4-hour session.
3. Add a dog-presence detector with an adaptive sampling schedule.
4. Add audio-energy gating and bark/whine candidates.
5. Build temporal rules for sustained activity, recovery, and repeated paths.
6. Add rare, opt-in semantic review of selected event frames.
7. Collect corrected clips before training a custom pet behavior model.

