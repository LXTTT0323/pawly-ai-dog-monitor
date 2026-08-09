import { NextResponse } from "next/server";
import { z } from "zod";
import { getPawlyUser } from "@/lib/auth";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { redeemGuestInvite } from "@/lib/security-store";

export const runtime = "nodejs";
const bodySchema = z.object({ token: z.string().min(32).max(120) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to accept this private invitation" }, { status: 401, headers: noStoreHeaders() });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid guest invitation" }, { status: 400, headers: noStoreHeaders() });
    const result = await redeemGuestInvite(parsed.data.token, user.id, user.email);
    if (!result?.room) return NextResponse.json({ error: "This guest invitation is expired, already used, or has been revoked" }, { status: 410, headers: noStoreHeaders() });
    return NextResponse.json({ roomCode: result.room.code, expiresAt: result.expiresAt }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not accept invitation" }, { status: 400, headers: noStoreHeaders() });
  }
}
