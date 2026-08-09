import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { getRoomByCode, revokeGuestInvite } from "@/lib/security-store";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ code: string; inviteId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    const { code, inviteId } = await params;
    const room = await getRoomByCode(code.toUpperCase());
    if (!user || !room || room.ownerEmail !== user.email) return NextResponse.json({ error: "Room not found" }, { status: 404, headers: noStoreHeaders() });
    const revoked = await revokeGuestInvite(room.id, inviteId);
    if (!revoked) return NextResponse.json({ error: "Invite not found" }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not revoke guest invite" }, { status: 400, headers: noStoreHeaders() });
  }
}
