# Pawly behavior inference and power plan

Date: 2026-07-21

## Decision

Do not run a large vision-language model on a continuous video stream. Use an adaptive local pipeline in which each expensive tier is activated by a cheaper tier.

```text
Tier 0: tiny pixel motion + audio energy
→ Tier 1: dog detection and tracking
→ Tier 2: temporal episode rules
→ Tier 3: rare semantic review of selected evidence
```

This is both the lowest-cost and most inspectable path for the web MVP.

## Tier 0 — always-on local gate

Already implemented in the local v0.2 branch:

- grayscale frame difference at 96 × 54;
- sample every 2 seconds while the room is settled;
- temporarily increase to every 750 ms after movement;
- send only state transitions, not every sample;
- no cloud model cost and no frame storage.

Next addition:

- local audio energy gate at 16 kHz mono;
- retain only a short rolling buffer in memory;
- discard it unless an audio event needs classification and the owner has enabled microphone analysis.

## Tier 1 — dog presence and location

Recommended web MVP model:

- MediaPipe Object Detector;
- EfficientDet-Lite0 uint8, 320 × 320 input;
- category allowlist limited to `dog` and optionally `person`;
- run in a Web Worker because the web API is synchronous;
- run approximately every 10–15 seconds while settled, every 1–2 seconds during a motion burst, and once immediately when live view starts.

Outputs:

- dog visible / not visible;
- bounding box and confidence;
- approximate centroid;
- size change and zone occupancy;
- evidence quality.

An object detector cannot by itself determine emotion or reliable dog posture. It is the locator for later temporal reasoning.

## Tier 2 — temporal behavior episodes

The first useful “behavior model” should be a state engine over time, not a frame classifier.

Initial episodes:

- `low_motion_span`: dog is visible and movement inside the dog region remains low;
- `active_episode`: movement inside the dog region is sustained;
- `out_of_view`: dog detector absent beyond the grace period;
- `repeated_path_candidate`: centroid repeatedly travels through a similar path or between the same zones;
- `vocal_candidate`: bark/whine-like audio event repeated or sustained;
- `recovered`: activity or vocal episode followed by a sustained low-motion span;
- `camera_unavailable`: capture, visibility, or network health failed.

Do not label `anxious`, `panicking`, `happy`, or `separation anxiety` from these signals.

## Audio model

Recommended starting point:

- MediaPipe Audio Classifier with YAMNet;
- activate it only after a cheap audio-energy threshold;
- allowlist dog/bark/whimper-adjacent classes and treat the output as a candidate;
- aggregate repeated candidates over time before notifying.

YAMNet is generic. A pet-specific audio model should be trained only after collecting consented, corrected clips.

## Tier 3 — optional semantic review

Use a multimodal model only for:

- an ambiguous but potentially important episode;
- an owner-requested review;
- a small contact sheet or several selected frames;
- a human-readable summary after deterministic measurements are already calculated.

Never stream continuous video to a multimodal model. Require opt-in, cap requests per household, and keep the model output subordinate to the event engine.

## Power architecture

The camera sensor and continuous video encoding/upload can consume more power than sparse local inference. The target architecture therefore separates observation from live viewing:

1. Keep a low-resolution local capture alive for the adaptive detector.
2. Do not encode and upload a full live stream when no owner is watching.
3. Start the WebRTC preview on demand when an owner opens live view.
4. Stop or sharply reduce preview publishing after the viewer leaves.
5. Keep event data and camera heartbeat connected at low bandwidth.
6. When possible, reduce capture resolution and frame rate while in observation-only mode.

The current production beta still publishes continuous LiveKit video. Do not change it while it is actively being used. Build and battery-test on the isolated v0.2 branch first.

## Proposed sampling policy

| State | Motion gate | Dog detector | Video uplink | Semantic AI |
|---|---:|---:|---:|---:|
| Settled, no viewer | 0.5 Hz | every 10–15 s | off | off |
| Motion burst | 1.3 Hz | every 1–2 s | off | off |
| Owner watching | 1.3 Hz | every 1–2 s | on | off |
| Candidate episode | 1.3 Hz | short burst | optional event evidence | rare/opt-in |
| Camera unavailable | heartbeat only | off | off | off |

These are starting values, not promises. Measure battery drain and missed events on at least two iPad generations before setting production defaults.

## Model progression

### Now

- EfficientDet-Lite0 for dog location;
- YAMNet behind an audio-energy gate;
- deterministic temporal rules;
- user correction buttons.

### After labeled data exists

- fine-tune a small dog detector for the fixed indoor camera angle;
- train a compact temporal classifier on dog crops, motion paths, and audio events;
- export to TFLite or ONNX and quantize for edge inference;
- evaluate by dog, coat color, lighting, room, camera angle, and device generation.

### Native app threshold

Move the camera station to a native iOS/iPadOS app when users retain but the browser limits reliability or efficiency. Core ML can use Apple's CPU, GPU, and Neural Engine with lower native overhead and better lifecycle control. The web app remains the owner dashboard.

## Release gates

- 4-hour observation completes without silent suspension;
- measured battery drain is acceptable while plugged in and documented while unplugged;
- dog-presence recall meets the beta threshold in the supported setup;
- fewer than two incorrect high-priority alerts per monitored day;
- every event explains the visible evidence and uncertainty;
- no emotional or medical diagnosis appears in product copy.

