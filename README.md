# Pawly Coach

A deployable, web-first private beta that turns a spare phone, tablet, or computer into a dog-aware room monitor and outing review.

## What works in this build

- 12-character private room setup.
- Camera and optional microphone capture on modern phones, tablets, and computers.
- Encrypted WebRTC live video through LiveKit.
- Owner live dashboard on another browser/device.
- One-tap room audio playback on the owner dashboard.
- Automatic black iPad standby after 30 seconds, with local tap or remote 60-second wake.
- Camera pause/resume and disconnect visibility.
- Local frame-difference motion and audio gates with no cloud inference cost.
- Local MediaPipe dog presence and location detection using EfficientDet-Lite0.
- Adaptive dog detection: slow while settled, temporarily faster after meaningful movement.
- Quick Check presets (10-30 minutes) and Going Out presets (30 minutes-4 hours).
- Dog visibility, sound, repeated movement, and camera-health timeline events.
- Meaningful state-transition events sent over the encrypted room data channel.
- Conservative rule-based session summaries.
- Optional, explicit OpenAI text summary with daily and monthly caps.
- PWA manifest and service worker shell.

## Local run

1. Copy `.env.example` to `.env.local`.
2. Start LiveKit: `docker compose up -d livekit`.
3. Install: `pnpm install`.
4. Start: `pnpm dev`.
5. Open `http://localhost:3000/setup`.

For a second device on the local network, serve the web app over HTTPS. Camera and microphone access are blocked on non-localhost HTTP origins.

## iPad standby behavior

After monitoring starts, the camera preview stays visible for 30 seconds and then Pawly covers the iPad with a nearly black standby screen. The camera, enabled microphone, local detectors, and live stream remain active. Tap the iPad or use **Wake camera display** on the owner dashboard to reveal the preview for 60 seconds.

Do not lock the iPad with its hardware button: iPadOS suspends browser camera capture when the device is locked. On LCD iPads, black pixels do not turn off the backlight, so lower the system brightness for the darkest result. OLED iPad Pro models benefit more from the black standby surface.

## Production environment

Required:

- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Optional AI:

- `AI_FEATURE_ENABLED=true`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.6-luna`
- `AI_DAILY_REQUEST_LIMIT=20`
- `AI_MONTHLY_BUDGET_USD=5`

Leave `AI_FEATURE_ENABLED=false` until the non-AI product loop is validated. The app remains useful and fully functional without an OpenAI key.

## Cost behavior

Continuous video and audio are never sent to OpenAI. Motion, sustained-sound, and dog detection run in the camera browser. The optional summary sends at most 100 compact text event records and requests at most 300 output tokens. It is invoked only by an explicit owner action and falls back to deterministic rules when disabled, capped, or unavailable.

The current in-memory dollar counter is sufficient for one private-beta server instance. Replace it with an atomic database ledger before enabling AI on a horizontally scaled deployment.

## Beta security boundary

The room key is an unguessable capability URL, not a full account system. This is appropriate only for a small private beta. Before public signup, add account authentication, household membership, revocable camera credentials, durable event storage, and audit logs as specified in the parent architecture documents.
