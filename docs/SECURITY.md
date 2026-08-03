# Pawly Security V1

## Security model

Pawly separates three concerns that used to be represented by one room link:

1. **Identity** — the owner signs in through the hosting platform.
2. **Authorization** — the server verifies room ownership or a non-revoked camera-device credential before issuing a LiveKit token.
3. **Confidentiality** — each room has an independent E2EE key. The key is encrypted at rest and returned only through an authenticated, no-store endpoint.

The 12-character room code is an identifier, not a password or bearer capability.

## Camera pairing

- The owner creates a random, single-use pairing token.
- The token expires after five minutes and is stored only as a SHA-256 hash.
- Pairing creates a 256-bit camera credential in an `HttpOnly`, `Secure`, `SameSite=Strict`, host-only cookie.
- Removing a camera revokes its database credential and disconnects its stable LiveKit participant identity.

## Realtime permissions

- Owner tokens may subscribe, publish microphone audio for talkback, and publish control data.
- Camera tokens may publish camera/microphone tracks and camera events.
- Tokens expire after ten minutes and are rate-limited.
- Both clients reject data and tracks whose server-signed participant metadata has the wrong role.
- Media tracks and data channels use a shared per-room LiveKit E2EE key.

## Data handling

- Continuous video is not stored by Pawly.
- Event clips remain in the owner's browser IndexedDB unless the owner downloads them.
- AI summaries receive compact event labels, relative timestamps, and confidence scores—not live video, audio, or saved clips.
- Sensitive endpoints use `Cache-Control: no-store`.

## Operational controls

- Durable room, device, pairing, access-log, and rate-limit state lives in D1.
- Mutating endpoints enforce same-origin requests.
- Security headers deny framing, suppress referrers, restrict browser capabilities, and set a Content Security Policy.
- `LIVEKIT_API_SECRET` and `PAWLY_KEY_ENCRYPTION_SECRET` must be stored only as production secrets and rotated after exposure.
