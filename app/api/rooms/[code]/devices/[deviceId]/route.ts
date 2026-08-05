import { RoomServiceClient } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { isRoomCode } from "@/lib/domain";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { getRoomByCode, logAccess, revokeDevice } from "@/lib/security-store";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ code: string; deviceId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to remove a device" }, { status: 401, headers: noStoreHeaders() });
    const { code: rawCode, deviceId } = await context.params;
    const code = rawCode.toUpperCase();
    if (!isRoomCode(code)) return NextResponse.json({ error: "Invalid room" }, { status: 400, headers: noStoreHeaders() });
    const room = await getRoomByCode(code);
    if (!room || room.ownerEmail !== user.email) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });
    const device = await revokeDevice(room.id, deviceId);
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404, headers: noStoreHeaders() });

    const serverUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (serverUrl && apiKey && apiSecret) {
      const service = new RoomServiceClient(serverUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), apiKey, apiSecret);
      await service.removeParticipant(`pawly-${room.id}`, `camera-${device.id}`, { revokeTokenTs: BigInt(Date.now()) }).catch(() => undefined);
    }
    await logAccess(room.id, "owner", user.email, "device_revoked");
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove device" }, { status: 403, headers: noStoreHeaders() });
  }
}
