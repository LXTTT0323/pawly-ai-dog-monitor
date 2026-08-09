import { NextResponse } from "next/server";
import { z } from "zod";
import { getPawlyUser } from "@/lib/auth";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { createGuestInvite, getRoomByCode, listGuestInvites } from "@/lib/security-store";

export const runtime = "nodejs";

const bodySchema = z.object({ durationHours: z.number().int().min(1).max(168).default(24) });

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getPawlyUser();
  const room = await getRoomByCode((await params).code.toUpperCase());
  if (!user || !room || room.ownerEmail !== user.email) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });
  const invites = await listGuestInvites(room.id);
  return NextResponse.json({ invites: invites.map((invite) => ({ id: invite.id, expiresAt: invite.expiresAt, redeemedAt: invite.redeemedAt, redeemedByEmail: invite.redeemedByEmail })) }, { headers: noStoreHeaders() });
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    const room = await getRoomByCode((await params).code.toUpperCase());
    if (!user || !room || room.ownerEmail !== user.email) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid guest invite" }, { status: 400, headers: noStoreHeaders() });
    const invite = await createGuestInvite(room, user.email, parsed.data.durationHours);
    const origin = new URL(request.url).origin;
    return NextResponse.json({ invite: { id: invite.id, expiresAt: invite.expiresAt, url: `${origin}/guest?token=${encodeURIComponent(invite.token)}` } }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create guest invite" }, { status: 400, headers: noStoreHeaders() });
  }
}
