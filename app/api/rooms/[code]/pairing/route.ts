import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { isRoomCode } from "@/lib/domain";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { consumeRateLimit, createPairingToken, getRoomByCode } from "@/lib/security-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to pair a camera" }, { status: 401, headers: noStoreHeaders() });
    const code = (await context.params).code.toUpperCase();
    if (!isRoomCode(code)) return NextResponse.json({ error: "Invalid room" }, { status: 400, headers: noStoreHeaders() });
    const room = await getRoomByCode(code);
    if (!room || room.ownerEmail !== user.email) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });
    if (!await consumeRateLimit(`pairing:${user.email}`, 12, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many pairing links. Try again later." }, { status: 429, headers: noStoreHeaders() });
    }
    const pairing = await createPairingToken(room);
    const url = new URL("/pair", request.url);
    url.searchParams.set("token", pairing.token);
    return NextResponse.json({ pairingUrl: url.toString(), expiresAt: pairing.expiresAt }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create pairing link" }, { status: 403, headers: noStoreHeaders() });
  }
}
