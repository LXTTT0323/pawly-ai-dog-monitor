import { AccessToken, TrackSource } from "livekit-server-sdk";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPawlyUser } from "@/lib/auth";
import { isRoomCode } from "@/lib/domain";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { consumeRateLimit, decryptRoomKey, getRoomByCode, logAccess, verifyDevice } from "@/lib/security-store";

export const runtime = "nodejs";

const requestSchema = z.object({
  roomCode: z.string().transform((value) => value.toUpperCase()).refine(isRoomCode),
  mode: z.enum(["camera", "owner"]),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid secure room request" }, { status: 400, headers: noStoreHeaders() });

    const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!serverUrl || !apiKey || !apiSecret) {
      return NextResponse.json({ error: "Live video is not configured on this deployment yet" }, { status: 503, headers: noStoreHeaders() });
    }

    const { roomCode, mode } = parsed.data;
    const room = await getRoomByCode(roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });

    let identity: string;
    let metadata: Record<string, string>;
    if (mode === "owner") {
      const user = await getPawlyUser();
      if (!user || user.email !== room.ownerEmail) {
        return NextResponse.json({ error: "Sign in as this room's owner" }, { status: 401, headers: noStoreHeaders() });
      }
      const ownerId = await shortHash(user.email);
      identity = `owner-${ownerId}-${crypto.randomUUID().slice(0, 8)}`;
      metadata = { role: "owner", roomId: room.id, ownerId };
      if (!await consumeRateLimit(`livekit:owner:${user.email}`, 60, 10 * 60 * 1000)) {
        return NextResponse.json({ error: "Too many connection attempts" }, { status: 429, headers: noStoreHeaders() });
      }
      await logAccess(room.id, "owner", user.email, "viewer_token_issued");
    } else {
      const deviceToken = (await cookies()).get(deviceCookieName())?.value;
      const verified = deviceToken ? await verifyDevice(deviceToken, roomCode) : null;
      if (!verified) {
        return NextResponse.json({ error: "This camera is not paired. Ask the owner for a new pairing link." }, { status: 401, headers: noStoreHeaders() });
      }
      identity = `camera-${verified.device.id}`;
      metadata = { role: "camera", roomId: room.id, deviceId: verified.device.id };
      if (!await consumeRateLimit(`livekit:camera:${verified.device.id}`, 60, 10 * 60 * 1000)) {
        return NextResponse.json({ error: "Too many connection attempts" }, { status: 429, headers: noStoreHeaders() });
      }
      await logAccess(room.id, "camera", verified.device.id, "camera_token_issued");
    }

    const token = new AccessToken(apiKey, apiSecret, { identity, ttl: "10m", metadata: JSON.stringify(metadata) });
    token.addGrant({
      roomJoin: true,
      room: `pawly-${room.id}`,
      canPublishSources: mode === "camera" ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
    });
    return NextResponse.json({
      token: await token.toJwt(),
      serverUrl,
      e2eeKey: await decryptRoomKey(room),
      role: mode,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Secure room connection failed" }, { status: 403, headers: noStoreHeaders() });
  }
}

function deviceCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-pawly_device" : "pawly_device";
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex").slice(0, 16);
}
