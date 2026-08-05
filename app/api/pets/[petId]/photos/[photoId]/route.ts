import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { deletePetPhoto, readPetPhoto } from "@/lib/pet-photo-store";
import { getPetForOwner } from "@/lib/profile-store";
import { assertSameOrigin, noStoreHeaders, SecurityError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ petId: string; photoId: string }> }) {
  const user = await getPawlyUser();
  if (!user) return NextResponse.json({ error: "Sign in to view pet photos" }, { status: 401, headers: noStoreHeaders() });
  const { petId, photoId } = await context.params;
  if (!await getPetForOwner(user.email, petId)) {
    return NextResponse.json({ error: "Pet photo not found" }, { status: 404, headers: noStoreHeaders() });
  }
  const stored = await readPetPhoto(user.email, petId, photoId);
  if (!stored) return NextResponse.json({ error: "Pet photo not found" }, { status: 404, headers: noStoreHeaders() });
  return new Response(stored.body, {
    headers: {
      "content-type": stored.photo.contentType,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ petId: string; photoId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to remove pet photos" }, { status: 401, headers: noStoreHeaders() });
    const { petId, photoId } = await context.params;
    if (!await getPetForOwner(user.email, petId)) {
      return NextResponse.json({ error: "Pet photo not found" }, { status: 404, headers: noStoreHeaders() });
    }
    if (!await deletePetPhoto(user.email, petId, photoId)) {
      return NextResponse.json({ error: "Pet photo not found" }, { status: 404, headers: noStoreHeaders() });
    }
    return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove pet photo" }, { status, headers: noStoreHeaders() });
  }
}
