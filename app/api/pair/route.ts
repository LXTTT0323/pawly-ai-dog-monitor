import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { consumeRateLimit, pairDevice } from "@/lib/security-store";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(32).max(120),
  deviceName: z.string().trim().min(1).max(60).default("Camera device"),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid pairing link" }, { status: 400, headers: noStoreHeaders() });
    if (!await consumeRateLimit("pair-attempts", 80, 10 * 60 * 1000)) {
      return NextResponse.json({ error: "Pairing is temporarily unavailable" }, { status: 429, headers: noStoreHeaders() });
    }
    const paired = await pairDevice(parsed.data.token, parsed.data.deviceName);
    if (!paired) return NextResponse.json({ error: "This pairing link is invalid, expired, or already used" }, { status: 410, headers: noStoreHeaders() });
    const response = NextResponse.json({ roomCode: paired.room.code, device: { id: paired.device.id, name: paired.device.name } }, { headers: noStoreHeaders() });
    response.cookies.set(deviceCookieName(), paired.deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 180 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not pair this device" }, { status: 403, headers: noStoreHeaders() });
  }
}

function deviceCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-pawly_device" : "pawly_device";
}
