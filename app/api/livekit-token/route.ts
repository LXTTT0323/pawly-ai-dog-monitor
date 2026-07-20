import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isRoomCode } from "@/lib/domain";

export const runtime = "nodejs";

const requestSchema = z.object({ roomCode: z.string().transform((value) => value.toUpperCase()).refine(isRoomCode), role: z.enum(["camera", "owner"]) });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid private room request" }, { status: 400 });

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) return NextResponse.json({ error: "Live video is not configured on this deployment yet" }, { status: 503 });

  const { roomCode, role } = parsed.data;
  const token = new AccessToken(apiKey, apiSecret, { identity: `${role}-${crypto.randomUUID()}`, ttl: "2h", metadata: JSON.stringify({ role }) });
  token.addGrant({ roomJoin: true, room: `pawly-${roomCode}`, canPublish: role === "camera", canSubscribe: true, canPublishData: true });
  return NextResponse.json({ token: await token.toJwt(), serverUrl }, { headers: { "Cache-Control": "no-store" } });
}
