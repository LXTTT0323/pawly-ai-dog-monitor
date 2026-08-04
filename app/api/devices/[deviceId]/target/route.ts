import { NextResponse } from "next/server";
import { z } from "zod";
import { getPawlyUser } from "@/lib/auth";
import { getPetTarget, savePetTarget } from "@/lib/profile-store";
import { assertSameOrigin, noStoreHeaders } from "@/lib/request-security";
import { getOwnedDevice } from "@/lib/security-store";

export const runtime = "nodejs";

const boxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((box) => box.x + box.width <= 1.001 && box.y + box.height <= 1.001);

async function authorize(deviceId: string) {
  const user = await getPawlyUser();
  if (!user) return null;
  const device = await getOwnedDevice(user.email, deviceId);
  return device ? { user, device } : null;
}

export async function GET(_request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await context.params;
  if (!await authorize(deviceId)) return NextResponse.json({ error: "Camera not found" }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ target: await getPetTarget(deviceId) }, { headers: noStoreHeaders() });
}

export async function PUT(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  try {
    assertSameOrigin(request);
    const { deviceId } = await context.params;
    if (!await authorize(deviceId)) return NextResponse.json({ error: "Camera not found" }, { status: 404, headers: noStoreHeaders() });
    const parsed = boxSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid pet target" }, { status: 400, headers: noStoreHeaders() });
    await savePetTarget(deviceId, parsed.data);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "Could not save pet target" }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  assertSameOrigin(request);
  const { deviceId } = await context.params;
  if (!await authorize(deviceId)) return NextResponse.json({ error: "Camera not found" }, { status: 404, headers: noStoreHeaders() });
  await savePetTarget(deviceId, null);
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
}
