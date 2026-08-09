import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { assertSameOrigin, noStoreHeaders, SecurityError } from "@/lib/request-security";
import { createOwnedRoom, getOwnedRoom, listDevices } from "@/lib/security-store";
import { upsertUser } from "@/lib/profile-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getPawlyUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage your room" }, { status: 401, headers: noStoreHeaders() });
  await upsertUser(user.email, user.displayName);
  const room = await getOwnedRoom(user.email);
  const devices = room ? await listDevices(room.id) : [];
  return NextResponse.json({
    room: room ? { code: room.code, createdAt: room.createdAt } : null,
    devices: devices.map((device) => ({ id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt })),
    user,
  }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to create a room" }, { status: 401, headers: noStoreHeaders() });
    await upsertUser(user.email, user.displayName);
    const room = await createOwnedRoom(user.email, user.displayName);
    const devices = await listDevices(room.id);
    return NextResponse.json({
      room: { code: room.code, createdAt: room.createdAt },
      devices: devices.map((device) => ({ id: device.id, name: device.name, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt })),
    }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create room" }, { status, headers: noStoreHeaders() });
  }
}
